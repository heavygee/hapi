import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { collectFileAttention } from '@/chat/fileAttention'

function toolBlock(
    id: string,
    name: string,
    input: unknown = {},
    children: ChatBlock[] = [],
    result: unknown = null,
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
            result,
            permission: undefined,
        },
        children,
    }
}

describe('collectFileAttention', () => {
    it('aggregates Claude pathful reads/writes', () => {
        const { touches, activity } = collectFileAttention([
            toolBlock('1', 'Read', { file_path: 'a.ts' }),
            toolBlock('2', 'Edit', { file_path: 'a.ts' }),
            toolBlock('3', 'Bash', { command: 'ls' }),
        ])
        expect(touches).toEqual([
            { path: 'a.ts', reads: 1, writes: 1, deletes: 0, total: 2 },
        ])
        expect(activity.total).toBe(2)
        expect(activity.pathless).toBe(0)
    })

    it('counts Cursor ACP pathless Read File / Edit File in activity', () => {
        const { touches, activity } = collectFileAttention([
            toolBlock('1', 'Read File', {}),
            toolBlock('2', 'Edit File', {}),
            toolBlock('3', 'Read File', { file_path: 'Read File' }),
            toolBlock('4', 'read_file', { path: 'src/x.ts' }),
        ])
        expect(touches).toEqual([
            { path: 'src/x.ts', reads: 1, writes: 0, deletes: 0, total: 1 },
        ])
        expect(activity).toMatchObject({
            reads: 3,
            writes: 1,
            pathless: 3,
            total: 4,
        })
    })

    it('harvests Edit File path from tool.result when input is empty', () => {
        const { touches, activity } = collectFileAttention([
            toolBlock(
                '1',
                'Edit File',
                {},
                [],
                { path: '/home/x/docs/plan.md', oldText: 'a', newText: 'b' },
            ),
            toolBlock('2', 'Read File', {}, [], { content: 'file body' }),
        ])
        expect(touches).toEqual([
            { path: '/home/x/docs/plan.md', reads: 0, writes: 1, deletes: 0, total: 1 },
        ])
        expect(activity).toMatchObject({
            reads: 1,
            writes: 1,
            pathless: 1,
            total: 2,
        })
    })

    it('recurses into Task children', () => {
        const { touches } = collectFileAttention([
            toolBlock('task-1', 'Task', { prompt: 'do it' }, [
                toolBlock('c1', 'Write', { file_path: 'deep.ts' }),
            ]),
        ])
        expect(touches[0]?.path).toBe('deep.ts')
    })
})
