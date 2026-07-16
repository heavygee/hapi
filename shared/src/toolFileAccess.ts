import { getInputStringAny } from './utils'

/**
 * Mode-agnostic knowledge of "what counts as a file touch" by an agent tool.
 *
 * This is the shared substrate for flow observability: the web session view
 * walks the normalized ChatBlock tree, the hub (later) walks raw messages, and
 * a future XR surface reads the same aggregates — but all of them must agree on
 * which tools touch files, whether that touch is a read or a write, and which
 * input field holds the path. That agreement lives here, once.
 *
 * Traversal is deliberately NOT part of this module: each consumer supplies its
 * own walk and feeds (toolName, input) pairs into a FileTouchAccumulator.
 */

export type FileAccessKind = 'read' | 'write'

const WRITE_TOOLS = new Set([
    'Edit',
    'Write',
    'StrReplace',
    'MultiEdit',
    'NotebookEdit',
])

const READ_TOOLS = new Set([
    'Read',
    'NotebookRead',
])

const PATH_KEYS = ['file_path', 'path', 'filePath', 'file']
const NOTEBOOK_KEYS = ['notebook_path']

/** Returns 'read' | 'write' for a path-bearing tool, or null if the tool does not touch a file. */
export function classifyFileTool(toolName: string): FileAccessKind | null {
    if (WRITE_TOOLS.has(toolName)) return 'write'
    if (READ_TOOLS.has(toolName)) return 'read'
    return null
}

/** Extracts the file path from a tool's input, honoring tool-specific key variance. Null if none. */
export function extractToolFilePath(toolName: string, input: unknown): string | null {
    const keys = toolName.startsWith('Notebook') ? NOTEBOOK_KEYS : PATH_KEYS
    return getInputStringAny(input, keys)
}

export type FileTouch = {
    path: string
    reads: number
    writes: number
    total: number
}

/**
 * Accumulates file touches across an arbitrary traversal. Consumers call
 * `add(toolName, input)` for every tool call they encounter; non-file tools and
 * path-less inputs are ignored. `result()` returns touches ranked by total
 * activity (desc), ties broken by writes then path for stable output.
 */
export class FileTouchAccumulator {
    private readonly byPath = new Map<string, FileTouch>()

    add(toolName: string, input: unknown): void {
        const kind = classifyFileTool(toolName)
        if (!kind) return
        const path = extractToolFilePath(toolName, input)
        if (!path) return
        const cur = this.byPath.get(path) ?? { path, reads: 0, writes: 0, total: 0 }
        if (kind === 'write') cur.writes++
        else cur.reads++
        cur.total++
        this.byPath.set(path, cur)
    }

    result(): FileTouch[] {
        return [...this.byPath.values()].sort(
            (a, b) => b.total - a.total || b.writes - a.writes || a.path.localeCompare(b.path),
        )
    }
}
