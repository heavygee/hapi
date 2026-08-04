import type { TraceEdge, TraceGraph, TraceNode } from '@/chat/traceGraph'

/**
 * Pure geometric layout for the session flow SVG graph.
 *
 * Depth → columns (subagent children to the right). Within a column, nodes
 * stack top→bottom in topological order induced by sequence edges.
 * No layout library — dogfood-weight only.
 */

export type LaidOutNode = TraceNode & {
    x: number
    y: number
    w: number
    h: number
}

export type LaidOutEdge = TraceEdge & {
    x1: number
    y1: number
    x2: number
    y2: number
}

export type TraceGraphLayout = {
    nodes: LaidOutNode[]
    edges: LaidOutEdge[]
    width: number
    height: number
}

const TOOL_W = 152
const TOOL_H = 44
const SUB_W = 220
const SUB_H = 56
const GAP_Y = 18
const COL_GAP = 56
const PAD = 24

function nodeSize(node: TraceNode): { w: number; h: number } {
    if (node.kind === 'subagent') return { w: SUB_W, h: SUB_H }
    return { w: TOOL_W, h: TOOL_H }
}

/** Stable topological order; falls back to input order on cycles. */
export function orderTraceNodes(nodes: TraceNode[], edges: TraceEdge[]): TraceNode[] {
    const ids = new Set(nodes.map((n) => n.id))
    const indeg = new Map<string, number>()
    const outs = new Map<string, string[]>()
    for (const n of nodes) {
        indeg.set(n.id, 0)
        outs.set(n.id, [])
    }
    for (const e of edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue
        indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
        outs.get(e.from)!.push(e.to)
    }
    const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
    const seen = new Set<string>()
    const ordered: TraceNode[] = []
    const byId = new Map(nodes.map((n) => [n.id, n]))
    while (queue.length > 0) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        const node = byId.get(id)
        if (node) ordered.push(node)
        for (const next of outs.get(id) ?? []) {
            const nextDeg = (indeg.get(next) ?? 1) - 1
            indeg.set(next, nextDeg)
            if (nextDeg <= 0) queue.push(next)
        }
    }
    for (const n of nodes) {
        if (!seen.has(n.id)) ordered.push(n)
    }
    return ordered
}

export function layoutTraceGraph(graph: TraceGraph): TraceGraphLayout {
    if (graph.nodes.length === 0) {
        return { nodes: [], edges: [], width: PAD * 2, height: PAD * 2 }
    }

    const ordered = orderTraceNodes(graph.nodes, graph.edges)
    const colWidth = Math.max(TOOL_W, SUB_W) + COL_GAP
    const nextY = new Map<number, number>()
    const laid: LaidOutNode[] = []
    const pos = new Map<string, LaidOutNode>()

    for (const node of ordered) {
        const { w, h } = nodeSize(node)
        const y = nextY.get(node.depth) ?? PAD
        const x = PAD + node.depth * colWidth
        const placed: LaidOutNode = { ...node, x, y, w, h }
        laid.push(placed)
        pos.set(node.id, placed)
        nextY.set(node.depth, y + h + GAP_Y)
    }

    const edges: LaidOutEdge[] = []
    for (const edge of graph.edges) {
        const from = pos.get(edge.from)
        const to = pos.get(edge.to)
        if (!from || !to) continue
        let x1: number
        let y1: number
        let x2: number
        let y2: number
        if (edge.kind === 'spawn' || from.depth !== to.depth) {
            x1 = from.x + from.w
            y1 = from.y + from.h / 2
            x2 = to.x
            y2 = to.y + to.h / 2
        } else {
            x1 = from.x + from.w / 2
            y1 = from.y + from.h
            x2 = to.x + to.w / 2
            y2 = to.y
        }
        edges.push({ ...edge, x1, y1, x2, y2 })
    }

    let maxX = 0
    let maxY = 0
    for (const n of laid) {
        maxX = Math.max(maxX, n.x + n.w)
        maxY = Math.max(maxY, n.y + n.h)
    }

    return {
        nodes: laid,
        edges,
        width: maxX + PAD,
        height: maxY + PAD,
    }
}

/** SVG path for an edge (straight for sequence, soft cubic for spawn). */
export function edgePath(edge: LaidOutEdge): string {
    const { x1, y1, x2, y2, kind } = edge
    if (kind === 'sequence' && Math.abs(x1 - x2) < 1) {
        return `M ${x1} ${y1} L ${x2} ${y2}`
    }
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}
