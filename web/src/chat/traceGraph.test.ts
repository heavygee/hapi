import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { buildTraceGraph } from '@/chat/traceGraph'

function toolBlock(
    id: string,
    name: string,
    children: ChatBlock[] = [],
    state: ToolCallBlock['tool']['state'] = 'completed',
    input: unknown = {},
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
            input,
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
    it('labels and collapses consecutive Cursor Read File calls', () => {
        const g = buildTraceGraph([
            toolBlock('a', 'Read File'),
            toolBlock('b', 'Read File'),
            toolBlock('c', 'Read File'),
            toolBlock('d', 'Edit File'),
            textBlock('t'),
        ])
        expect(g.nodes).toHaveLength(2)
        expect(g.nodes[0]).toMatchObject({ label: 'Read', count: 3, flowKind: 'read' })
        expect(g.nodes[1]).toMatchObject({ label: 'Edit', count: 1, flowKind: 'write' })
        expect(g.edges).toEqual([{ from: 'a', to: 'd', kind: 'sequence' }])
    })

    it('labels shell command-as-name tools with truncated detail', () => {
        const g = buildTraceGraph([
            toolBlock('s', '`cd /tmp && ls -la`', [], 'completed', { command: 'cd /tmp && ls -la' }),
        ])
        expect(g.nodes[0]).toMatchObject({
            label: 'Shell',
            flowKind: 'shell',
            detail: 'cd /tmp && ls -la',
        })
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
        expect(g.nodes.find((n) => n.id === 'c1')).toMatchObject({ depth: 1, label: 'Read' })
        expect(g.edges).toEqual([
            { from: 'task', to: 'c1', kind: 'spawn' },
            { from: 'c1', to: 'c2', kind: 'sequence' },
        ])
    })

    it('returns empty graph for no tool calls', () => {
        expect(buildTraceGraph([textBlock('t')])).toEqual({ nodes: [], edges: [] })
    })
})
