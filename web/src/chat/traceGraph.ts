import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { isSubagentToolName, subagentFlowDetail, subagentFlowLabel } from '@/chat/subagentTool'
import { flowToolDetail, flowToolKind, flowToolLabel } from '@hapi/protocol'

/**
 * Structured execution graph derived from the ChatBlock tree.
 *
 * Nodes are tool calls and subagents; text/reasoning turns are omitted so the
 * graph reads as "what the agent did", not "what it said". Consecutive tools of
 * the same flow kind (e.g. many "Read File") collapse into one node with a
 * `count`, which is load-bearing for Cursor sessions that emit hundreds of
 * pathless file tools.
 *
 * Cursor subagents (`CursorTask` / `Task: …`) usually have no nested children
 * in the parent session — their work ran elsewhere. We still surface the
 * title/description so the graph is not a wall of anonymous "Task" rows.
 */

export type TraceNodeKind = 'tool' | 'subagent'
export type TraceNodeState = 'pending' | 'running' | 'completed' | 'error'

export type TraceNode = {
    id: string
    kind: TraceNodeKind
    /** Raw tool name (may be a shell command on Cursor ACP). */
    toolName: string
    /** Stable kind for grouping (shell / read / write / …). */
    flowKind: string
    /** Short human label ("Shell", "Read", "Edit", or subagent title). */
    label: string
    /** Optional detail (truncated command, path, or model · duration). */
    detail: string | null
    /** Collapsed consecutive same-kind count (≥1). */
    count: number
    state: TraceNodeState
    depth: number
    childCount: number
}

export type TraceEdge = {
    from: string
    to: string
    kind: 'sequence' | 'spawn'
}

export type TraceGraph = {
    nodes: TraceNode[]
    edges: TraceEdge[]
}

/** Soft cap for the execution list — long Cursor sessions otherwise dump 100+ rows. */
export const TRACE_GRAPH_DISPLAY_CAP = 48

function toolChildren(block: ToolCallBlock): ToolCallBlock[] {
    return block.children.filter((c): c is ToolCallBlock => c.kind === 'tool-call')
}

function worstState(a: TraceNodeState, b: TraceNodeState): TraceNodeState {
    const rank: Record<TraceNodeState, number> = { error: 3, running: 2, pending: 1, completed: 0 }
    return rank[a] >= rank[b] ? a : b
}

/** Skip ACP placeholders that never received a CursorTask title enrichment. */
function isBlankSubagentPlaceholder(block: ToolCallBlock): boolean {
    if (!isSubagentToolName(block.tool.name)) return false
    if (block.tool.name === 'CursorTask') return false
    const input = block.tool.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return true
    const obj = input as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim() : ''
    const description = typeof obj.description === 'string' ? obj.description.trim() : ''
    const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : ''
    // Only `_toolName: "task"` (or empty) — no human label yet.
    return !title && !description && !prompt
}

export function buildTraceGraph(blocks: ChatBlock[]): TraceGraph {
    const nodes: TraceNode[] = []
    const edges: TraceEdge[] = []

    const walk = (bs: ChatBlock[], depth: number, parentId: string | null) => {
        const toolBlocks = bs.filter((b): b is ToolCallBlock => b.kind === 'tool-call')
        let prevId: string | null = null
        let open: TraceNode | null = null

        const flush = () => {
            if (open) {
                nodes.push(open)
                open = null
            }
        }

        for (const block of toolBlocks) {
            if (isBlankSubagentPlaceholder(block)) continue

            const isSub = isSubagentToolName(block.tool.name)
            const children = isSub ? toolChildren(block) : []
            const flowKind = isSub ? `subagent:${block.tool.name}` : flowToolKind(block.tool.name)
            const label = isSub
                ? subagentFlowLabel(block.tool.name, block.tool.input)
                : flowToolLabel(block.tool.name)
            const detail = isSub
                ? subagentFlowDetail(block.tool.input)
                : flowToolDetail(block.tool.name, block.tool.input)

            // Collapse consecutive same-kind non-subagent tools (Cursor Read File spam).
            // Subagents never collapse — each title is a distinct phase.
            if (!isSub && open && open.flowKind === flowKind && open.depth === depth) {
                open.count++
                open.state = worstState(open.state, block.tool.state)
                // Prefer a concrete detail when collapsing (last wins).
                if (detail) open.detail = detail
                prevId = open.id
                continue
            }

            flush()
            const node: TraceNode = {
                id: block.id,
                kind: isSub ? 'subagent' : 'tool',
                toolName: block.tool.name,
                flowKind,
                label,
                detail,
                count: 1,
                state: block.tool.state,
                depth,
                childCount: children.length,
            }
            open = node

            if (prevId) {
                edges.push({ from: prevId, to: node.id, kind: 'sequence' })
            } else if (parentId) {
                edges.push({ from: parentId, to: node.id, kind: 'spawn' })
            }
            prevId = node.id

            if (isSub && children.length > 0) {
                flush()
                walk(children, depth + 1, node.id)
                prevId = block.id
            }
        }
        flush()
    }

    walk(blocks, 0, null)
    return { nodes, edges }
}

/** Slice nodes for display; keep all subagent rows even when over the soft cap. */
export function selectTraceNodesForDisplay(nodes: TraceNode[], cap = TRACE_GRAPH_DISPLAY_CAP): {
    visible: TraceNode[]
    hiddenCount: number
} {
    if (nodes.length <= cap) return { visible: nodes, hiddenCount: 0 }
    const subagents = nodes.filter((n) => n.kind === 'subagent')
    const tools = nodes.filter((n) => n.kind !== 'subagent')
    const toolBudget = Math.max(0, cap - subagents.length)
    // Prefer the tail of the tool stream (recent work) over the ancient prefix.
    const visibleTools = tools.length <= toolBudget ? tools : tools.slice(tools.length - toolBudget)
    const visibleIds = new Set([...subagents, ...visibleTools].map((n) => n.id))
    const visible = nodes.filter((n) => visibleIds.has(n.id))
    return { visible, hiddenCount: nodes.length - visible.length }
}
