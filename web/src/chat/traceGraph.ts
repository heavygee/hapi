import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { isSubagentToolName } from '@/chat/subagentTool'
import { flowToolDetail, flowToolKind, flowToolLabel } from '@hapi/protocol'

/**
 * Structured execution graph derived from the ChatBlock tree.
 *
 * Nodes are tool calls and subagents; text/reasoning turns are omitted so the
 * graph reads as "what the agent did", not "what it said". Consecutive tools of
 * the same flow kind (e.g. many "Read File") collapse into one node with a
 * `count`, which is load-bearing for Cursor sessions that emit hundreds of
 * pathless file tools.
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
    /** Short human label ("Shell", "Read", "Edit"). */
    label: string
    /** Optional detail (truncated command or path). */
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

function toolChildren(block: ToolCallBlock): ToolCallBlock[] {
    return block.children.filter((c): c is ToolCallBlock => c.kind === 'tool-call')
}

function worstState(a: TraceNodeState, b: TraceNodeState): TraceNodeState {
    const rank: Record<TraceNodeState, number> = { error: 3, running: 2, pending: 1, completed: 0 }
    return rank[a] >= rank[b] ? a : b
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
            const isSub = isSubagentToolName(block.tool.name)
            const children = isSub ? toolChildren(block) : []
            const flowKind = isSub ? `subagent:${block.tool.name}` : flowToolKind(block.tool.name)
            const label = isSub ? block.tool.name : flowToolLabel(block.tool.name)
            const detail = isSub ? null : flowToolDetail(block.tool.name, block.tool.input)

            // Collapse consecutive same-kind non-subagent tools (Cursor Read File spam).
            if (!isSub && open && open.flowKind === flowKind && open.depth === depth) {
                open.count++
                open.state = worstState(open.state, block.tool.state)
                // Keep first id for edge stability; refresh detail only if we lacked one.
                if (!open.detail && detail) open.detail = detail
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
                walk(children, depth + 1, block.id)
                prevId = block.id
            }
        }
        flush()
    }

    walk(blocks, 0, null)
    return { nodes, edges }
}
