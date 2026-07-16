import { describe, expect, test } from 'bun:test'
import {
    classifyFileTool,
    extractToolFilePath,
    FileTouchAccumulator,
} from './toolFileAccess'

describe('classifyFileTool', () => {
    test('classifies write tools', () => {
        for (const name of ['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']) {
            expect(classifyFileTool(name)).toBe('write')
        }
    })

    test('classifies read tools', () => {
        expect(classifyFileTool('Read')).toBe('read')
        expect(classifyFileTool('NotebookRead')).toBe('read')
    })

    test('returns null for non-file tools', () => {
        for (const name of ['Bash', 'Grep', 'Glob', 'WebSearch', 'Task', 'mcp__foo__bar']) {
            expect(classifyFileTool(name)).toBeNull()
        }
    })
})

describe('extractToolFilePath', () => {
    test('reads the common file_path key', () => {
        expect(extractToolFilePath('Edit', { file_path: 'src/a.ts' })).toBe('src/a.ts')
    })

    test('falls back across path key variants', () => {
        expect(extractToolFilePath('Read', { path: 'src/b.ts' })).toBe('src/b.ts')
        expect(extractToolFilePath('Read', { filePath: 'src/c.ts' })).toBe('src/c.ts')
        expect(extractToolFilePath('Read', { file: 'src/d.ts' })).toBe('src/d.ts')
    })

    test('uses notebook_path for notebook tools', () => {
        expect(extractToolFilePath('NotebookEdit', { notebook_path: 'nb.ipynb' })).toBe('nb.ipynb')
        // notebook tools must not read the generic file_path key
        expect(extractToolFilePath('NotebookEdit', { file_path: 'wrong.ts' })).toBeNull()
    })

    test('returns null when no path present', () => {
        expect(extractToolFilePath('Edit', { content: 'x' })).toBeNull()
        expect(extractToolFilePath('Edit', null)).toBeNull()
    })
})

describe('FileTouchAccumulator', () => {
    test('counts reads and writes per path', () => {
        const acc = new FileTouchAccumulator()
        acc.add('Read', { file_path: 'a.ts' })
        acc.add('Edit', { file_path: 'a.ts' })
        acc.add('Write', { file_path: 'a.ts' })
        acc.add('Read', { file_path: 'b.ts' })
        const result = acc.result()
        expect(result).toEqual([
            { path: 'a.ts', reads: 1, writes: 2, total: 3 },
            { path: 'b.ts', reads: 1, writes: 0, total: 1 },
        ])
    })

    test('ignores non-file tools and path-less inputs', () => {
        const acc = new FileTouchAccumulator()
        acc.add('Bash', { command: 'ls' })
        acc.add('Edit', { content: 'no path here' })
        acc.add('Grep', { pattern: 'x' })
        expect(acc.result()).toEqual([])
    })

    test('ranks by total, then writes, then path', () => {
        const acc = new FileTouchAccumulator()
        acc.add('Read', { file_path: 'low.ts' })
        acc.add('Read', { file_path: 'hi.ts' })
        acc.add('Edit', { file_path: 'hi.ts' })
        // tie on total(1) between these two → writer first, then alpha
        acc.add('Edit', { file_path: 'zeta.ts' })
        acc.add('Read', { file_path: 'alpha.ts' })
        const paths = acc.result().map((t) => t.path)
        expect(paths).toEqual(['hi.ts', 'zeta.ts', 'alpha.ts', 'low.ts'])
    })
})
