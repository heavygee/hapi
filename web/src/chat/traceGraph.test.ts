import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { buildTraceGraph } from '@/chat/traceGraph'

function toolBlock(
    id: string,
    name: string,
    children: ChatBlock[] = [],
    state: ToolCallBlock['tool']['state'] = 'completed',
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        invokedAt: null,
        tool: {
            id,
            name,
            state,
            input: {},
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            execStartedAt: null,
            execCompletedAt: null,
            description: null,
            result: null,
            permission: undefined,
        },
        children,
    }
}

function textBlock(id: string): ChatBlock {
    return { kind: 'agent-text', id, localId: null, createdAt: 1, text: 'x' }
}

describe('buildTraceGraph', () => {
    it('chains top-level tool calls with sequence edges, skipping text', () => {
        const g = buildTraceGraph([
            toolBlock('a', 'Read'),
            textBlock('t'),
            toolBlock('b', 'Edit'),
        ])
        expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b'])
        expect(g.nodes.every((n) => n.kind === 'tool' && n.depth === 0)).toBe(true)
        expect(g.edges).toEqual([{ from: 'a', to: 'b', kind: 'sequence' }])
    })

    it('marks subagents and spawns children at increased depth', () => {
        const g = buildTraceGraph([
            toolBlock('task', 'Task', [
                toolBlock('c1', 'Read'),
                toolBlock('c2', 'Write'),
            ]),
        ])
        const task = g.nodes.find((n) => n.id === 'task')
        expect(task).toMatchObject({ kind: 'subagent', depth: 0, childCount: 2 })
        expect(g.nodes.find((n) => n.id === 'c1')).toMatchObject({ depth: 1 })
        expect(g.edges).toEqual([
            { from: 'task', to: 'c1', kind: 'spawn' },
            { from: 'c1', to: 'c2', kind: 'sequence' },
        ])
    })

    it('carries tool state through to nodes', () => {
        const g = buildTraceGraph([toolBlock('a', 'Bash', [], 'error')])
        expect(g.nodes[0]?.state).toBe('error')
    })

    it('returns empty graph for no tool calls', () => {
        expect(buildTraceGraph([textBlock('t')])).toEqual({ nodes: [], edges: [] })
    })
})
