import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { isSubagentToolName } from '@/chat/subagentTool'

/**
 * Structured execution graph derived from the ChatBlock tree.
 *
 * Nodes are tool calls and subagents; text/reasoning turns are omitted so the
 * graph reads as "what the agent did", not "what it said". Edges are either
 * `sequence` (one step then the next at the same depth) or `spawn` (a subagent
 * launching its first child step). Depth 0 is the main agent line; each subagent
 * increments depth for its children.
 *
 * This is the data contract for any flow renderer (DOM columns now, SVG/canvas
 * later, XR orbs eventually) — the layout lives in the view, the topology here.
 */

export type TraceNodeKind = 'tool' | 'subagent'
export type TraceNodeState = 'pending' | 'running' | 'completed' | 'error'

export type TraceNode = {
    id: string
    kind: TraceNodeKind
    toolName: string
    state: TraceNodeState
    depth: number
    /** Number of direct child steps (subagents only). */
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

function toolChildren(block: ToolCallBlock): ToolCallBlock[] {
    return block.children.filter((c): c is ToolCallBlock => c.kind === 'tool-call')
}

export function buildTraceGraph(blocks: ChatBlock[]): TraceGraph {
    const nodes: TraceNode[] = []
    const edges: TraceEdge[] = []

    const walk = (bs: ChatBlock[], depth: number, parentId: string | null) => {
        const toolBlocks = bs.filter((b): b is ToolCallBlock => b.kind === 'tool-call')
        let prevId: string | null = null

        for (const block of toolBlocks) {
            const isSub = isSubagentToolName(block.tool.name)
            const children = isSub ? toolChildren(block) : []
            nodes.push({
                id: block.id,
                kind: isSub ? 'subagent' : 'tool',
                toolName: block.tool.name,
                state: block.tool.state,
                depth,
                childCount: children.length,
            })

            if (prevId) {
                edges.push({ from: prevId, to: block.id, kind: 'sequence' })
            } else if (parentId) {
                edges.push({ from: parentId, to: block.id, kind: 'spawn' })
            }
            prevId = block.id

            if (isSub && children.length > 0) {
                walk(children, depth + 1, block.id)
            }
        }
    }

    walk(blocks, 0, null)
    return { nodes, edges }
}
