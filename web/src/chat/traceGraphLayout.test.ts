import { describe, expect, it } from 'vitest'
import type { TraceGraph } from '@/chat/traceGraph'
import { edgePath, layoutTraceGraph, orderTraceNodes } from '@/chat/traceGraphLayout'

function node(
    id: string,
    opts: Partial<TraceGraph['nodes'][number]> = {},
): TraceGraph['nodes'][number] {
    return {
        id,
        kind: 'tool',
        toolName: 'Read',
        flowKind: 'read',
        label: 'Read',
        detail: null,
        count: 1,
        state: 'completed',
        depth: 0,
        childCount: 0,
        ...opts,
    }
}

describe('layoutTraceGraph', () => {
    it('stacks depth-0 sequence top to bottom', () => {
        const graph: TraceGraph = {
            nodes: [node('a'), node('b'), node('c')],
            edges: [
                { from: 'a', to: 'b', kind: 'sequence' },
                { from: 'b', to: 'c', kind: 'sequence' },
            ],
        }
        const layout = layoutTraceGraph(graph)
        expect(layout.nodes).toHaveLength(3)
        const a = layout.nodes.find((n) => n.id === 'a')!
        const b = layout.nodes.find((n) => n.id === 'b')!
        const c = layout.nodes.find((n) => n.id === 'c')!
        expect(a.y).toBeLessThan(b.y)
        expect(b.y).toBeLessThan(c.y)
        expect(a.x).toBe(b.x)
    })

    it('places spawned children in a deeper column', () => {
        const graph: TraceGraph = {
            nodes: [
                node('task', { kind: 'subagent', label: 'Task', flowKind: 'subagent:Task', childCount: 1 }),
                node('child', { depth: 1, label: 'Edit', flowKind: 'write' }),
            ],
            edges: [{ from: 'task', to: 'child', kind: 'spawn' }],
        }
        const layout = layoutTraceGraph(graph)
        const task = layout.nodes.find((n) => n.id === 'task')!
        const child = layout.nodes.find((n) => n.id === 'child')!
        expect(child.x).toBeGreaterThan(task.x)
        expect(layout.edges[0]?.kind).toBe('spawn')
        expect(edgePath(layout.edges[0]!)).toContain('C')
    })

    it('orderTraceNodes respects sequence edges', () => {
        const nodes = [node('c'), node('a'), node('b')]
        const edges = [
            { from: 'a', to: 'b', kind: 'sequence' as const },
            { from: 'b', to: 'c', kind: 'sequence' as const },
        ]
        expect(orderTraceNodes(nodes, edges).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    })
})
