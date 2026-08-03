import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { buildTraceGraph, selectTraceNodesForDisplay } from '@/chat/traceGraph'

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
            ], 'completed', { prompt: 'explore', subagent_type: 'Explore' }),
        ])
        const task = g.nodes.find((n) => n.id === 'task')
        expect(task).toMatchObject({ kind: 'subagent', depth: 0, childCount: 2 })
        expect(g.nodes.find((n) => n.id === 'c1')).toMatchObject({ depth: 1, label: 'Read' })
        expect(g.edges).toEqual([
            { from: 'task', to: 'c1', kind: 'spawn' },
            { from: 'c1', to: 'c2', kind: 'sequence' },
        ])
    })

    it('labels CursorTask by title and shows model · duration detail', () => {
        const g = buildTraceGraph([
            toolBlock('ct', 'CursorTask', [], 'completed', {
                title: 'Research ER standards',
                description: 'Research ER standards',
                model: 'claude-opus-4-8-medium',
                durationMs: 40630,
                prompt: '…',
            }),
        ])
        expect(g.nodes[0]).toMatchObject({
            kind: 'subagent',
            label: 'Research ER standards',
            detail: 'claude-opus-4-8-medium · 40.6s',
            childCount: 0,
        })
    })

    it('skips blank Task: Subagent task placeholders without title', () => {
        const g = buildTraceGraph([
            toolBlock('ph', 'Task: Subagent task', [], 'running', { _toolName: 'task' }),
            toolBlock('ct', 'CursorTask', [], 'completed', {
                title: 'Investigate Mermaid render issue',
                durationMs: 93507,
                model: 'gpt-5.3-codex-low',
            }),
        ])
        expect(g.nodes).toHaveLength(1)
        expect(g.nodes[0].label).toBe('Investigate Mermaid render issue')
    })

    it('returns empty graph for no tool calls', () => {
        expect(buildTraceGraph([textBlock('t')])).toEqual({ nodes: [], edges: [] })
    })
})

describe('selectTraceNodesForDisplay', () => {
    it('keeps all subagents and recent tools when over cap', () => {
        const nodes = [
            ...Array.from({ length: 10 }, (_, i) => ({
                id: `t${i}`,
                kind: 'tool' as const,
                toolName: 'Read File',
                flowKind: 'read',
                label: 'Read',
                detail: null,
                count: 1,
                state: 'completed' as const,
                depth: 0,
                childCount: 0,
            })),
            {
                id: 'sub',
                kind: 'subagent' as const,
                toolName: 'CursorTask',
                flowKind: 'subagent:CursorTask',
                label: 'Important',
                detail: null,
                count: 1,
                state: 'completed' as const,
                depth: 0,
                childCount: 0,
            },
        ]
        const { visible, hiddenCount } = selectTraceNodesForDisplay(nodes, 4)
        expect(visible.some((n) => n.id === 'sub')).toBe(true)
        expect(visible).toHaveLength(4)
        expect(hiddenCount).toBe(7)
        // Recent tools preferred
        expect(visible.filter((n) => n.kind === 'tool').map((n) => n.id)).toEqual(['t7', 't8', 't9'])
    })
})
