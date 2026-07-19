import { describe, expect, test } from 'bun:test'
import {
    classifyFileTool,
    extractToolFilePath,
    FileTouchAccumulator,
    flowToolDetail,
    flowToolKind,
    flowToolLabel,
    isShellLikeToolName,
} from './toolFileAccess'

describe('classifyFileTool', () => {
    test('classifies Claude write tools', () => {
        for (const name of ['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']) {
            expect(classifyFileTool(name)).toBe('write')
        }
    })

    test('classifies Cursor ACP display titles', () => {
        expect(classifyFileTool('Read File')).toBe('read')
        expect(classifyFileTool('Edit File')).toBe('write')
        expect(classifyFileTool('Write File')).toBe('write')
        expect(classifyFileTool('Delete File')).toBe('delete')
    })

    test('classifies Cursor snake_case and Codex patch tools', () => {
        expect(classifyFileTool('read_file')).toBe('read')
        expect(classifyFileTool('write_file')).toBe('write')
        expect(classifyFileTool('CodexPatch')).toBe('write')
    })

    test('returns null for non-file tools', () => {
        for (const name of ['Bash', 'Grep', 'grep', 'Find', 'Web Search', 'MCP: tool']) {
            expect(classifyFileTool(name)).toBeNull()
        }
    })
})

describe('extractToolFilePath', () => {
    test('reads path / file_path variants', () => {
        expect(extractToolFilePath('Edit', { file_path: 'src/a.ts' })).toBe('src/a.ts')
        expect(extractToolFilePath('read_file', { path: '/tmp/x.ts' })).toBe('/tmp/x.ts')
    })

    test('rejects Cursor ACP title echoed as file_path', () => {
        expect(extractToolFilePath('Read File', { file_path: 'Read File' })).toBeNull()
        expect(extractToolFilePath('Edit File', {})).toBeNull()
    })
})

describe('isShellLikeToolName / flow labels', () => {
    test('detects backtick and command-as-name shells', () => {
        expect(isShellLikeToolName('`cd /tmp && ls`')).toBe(true)
        expect(isShellLikeToolName('cd /home/heavygee/coding/hapi && git status')).toBe(true)
        expect(isShellLikeToolName('Bash')).toBe(true)
        expect(isShellLikeToolName('Read File')).toBe(false)
    })

    test('labels shell and file tools for flow UI', () => {
        expect(flowToolKind('`git status`')).toBe('shell')
        expect(flowToolLabel('`git status`')).toBe('Shell')
        expect(flowToolLabel('Read File')).toBe('Read')
        expect(flowToolLabel('Edit File')).toBe('Edit')
        expect(flowToolDetail('`cd /tmp && ls`', { command: 'cd /tmp && ls' })).toBe('cd /tmp && ls')
    })
})

describe('FileTouchAccumulator', () => {
    test('counts pathful touches and pathless Cursor ACP activity', () => {
        const acc = new FileTouchAccumulator()
        acc.add('Read', { file_path: 'a.ts' })
        acc.add('Edit File', {}) // Cursor ACP — no path
        acc.add('Read File', { file_path: 'Read File' }) // garbage path
        acc.add('read_file', { path: 'b.ts' })
        expect(acc.result()).toEqual([
            { path: 'a.ts', reads: 1, writes: 0, deletes: 0, total: 1 },
            { path: 'b.ts', reads: 1, writes: 0, deletes: 0, total: 1 },
        ])
        expect(acc.activitySummary()).toEqual({
            reads: 3,
            writes: 1,
            deletes: 0,
            pathless: 2,
            total: 4,
        })
    })
})
