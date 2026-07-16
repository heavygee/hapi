import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { collectFileTouches } from '@/chat/fileAttention'

function toolBlock(
    id: string,
    name: string,
    input: unknown = {},
    children: ChatBlock[] = [],
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
            state: 'completed',
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
    return { kind: 'agent-text', id, localId: null, createdAt: 1, text: 'note' }
}

describe('collectFileTouches', () => {
    it('aggregates reads and writes across top-level tool calls', () => {
        const blocks: ChatBlock[] = [
            toolBlock('1', 'Read', { file_path: 'a.ts' }),
            toolBlock('2', 'Edit', { file_path: 'a.ts' }),
            textBlock('3'),
            toolBlock('4', 'Bash', { command: 'ls' }),
        ]
        expect(collectFileTouches(blocks)).toEqual([
            { path: 'a.ts', reads: 1, writes: 1, total: 2 },
        ])
    })

    it('recurses into subagent (Task) children', () => {
        const blocks: ChatBlock[] = [
            toolBlock('task-1', 'Task', { prompt: 'do it' }, [
                toolBlock('c1', 'Write', { file_path: 'deep.ts' }),
                toolBlock('c2', 'Read', { file_path: 'deep.ts' }),
            ]),
        ]
        expect(collectFileTouches(blocks)).toEqual([
            { path: 'deep.ts', reads: 1, writes: 1, total: 2 },
        ])
    })

    it('returns empty when no file tools are present', () => {
        expect(collectFileTouches([textBlock('1'), toolBlock('2', 'Grep', { pattern: 'x' })])).toEqual([])
    })
})
