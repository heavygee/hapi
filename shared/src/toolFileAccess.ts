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
 *
 * Cursor ACP note (live hub data, 2026-07): most "Read File" / "Edit File"
 * tool-calls arrive with empty `input` — the path is not persisted. Path-ranked
 * heatmaps therefore under-count on Cursor sessions; `FileActivityAccumulator`
 * still counts those calls by kind so the session flow view has a useful signal.
 */

export type FileAccessKind = 'read' | 'write' | 'delete'

const WRITE_TOOLS = new Set([
    // Claude Code
    'Edit',
    'Write',
    'StrReplace',
    'MultiEdit',
    'NotebookEdit',
    // Cursor ACP display titles (common on :3006 Cursor sessions)
    'Edit File',
    'Write File',
    // Cursor legacy / snake_case
    'write_file',
    'edit_file',
    'search_replace',
    // Codex
    'CodexPatch',
    'CodexDiff',
])

const READ_TOOLS = new Set([
    'Read',
    'NotebookRead',
    'Read File',
    'read_file',
])

const DELETE_TOOLS = new Set([
    'Delete',
    'Delete File',
    'delete_file',
])

const PATH_KEYS = ['file_path', 'path', 'filePath', 'file', 'target_file']
const NOTEBOOK_KEYS = ['notebook_path']

/** Returns access kind for a file-bearing tool, or null if the tool does not touch a file. */
export function classifyFileTool(toolName: string): FileAccessKind | null {
    if (WRITE_TOOLS.has(toolName)) return 'write'
    if (READ_TOOLS.has(toolName)) return 'read'
    if (DELETE_TOOLS.has(toolName)) return 'delete'
    return null
}

/**
 * True when `name` is a Cursor/ACP shell tool whose "name" field is the command
 * itself (often backtick-wrapped), rather than a stable tool id like "Bash".
 */
export function isShellLikeToolName(toolName: string): boolean {
    if (!toolName) return false
    if (toolName === 'Bash' || toolName === 'CodexBash' || toolName === 'Shell' || toolName === 'shell_command') {
        return true
    }
    if (toolName.startsWith('`')) return true
    if (toolName.includes('\n')) return true
    // Bare command-as-name (short or long) without looking like a Title Case tool.
    if (/^(cd|git|ls|cat|head|tail|curl|wget|gh|bun|npm|pnpm|yarn|python|python3|node|sqlite3|rg|grep|find|echo|export|HUB=|JWT=|TOKEN=)\b/i.test(toolName)) {
        return true
    }
    return false
}

/** Stable kind key for flow summaries / consecutive collapsing. */
export function flowToolKind(toolName: string): string {
    if (isShellLikeToolName(toolName)) return 'shell'
    const fileKind = classifyFileTool(toolName)
    if (fileKind === 'read') return 'read'
    if (fileKind === 'write') return 'write'
    if (fileKind === 'delete') return 'delete'
    if (toolName === 'grep' || toolName === 'Grep') return 'grep'
    if (toolName === 'Find' || toolName === 'Glob' || toolName === 'LS') return 'find'
    if (toolName === 'Web Search' || toolName === 'WebSearch') return 'web-search'
    if (toolName === 'Read Lints' || toolName === 'read_lints') return 'lints'
    if (toolName === 'Update TODOs' || toolName === 'TodoWrite') return 'todos'
    if (toolName.startsWith('MCP:') || toolName.startsWith('mcp__')) return 'mcp'
    if (toolName === 'Create Plan' || toolName === 'update_plan') return 'plan'
    return toolName
}

/** Human label for a tool kind / name in flow views. */
export function flowToolLabel(toolName: string): string {
    const kind = flowToolKind(toolName)
    switch (kind) {
        case 'shell': return 'Shell'
        case 'read': return 'Read'
        case 'write': return 'Edit'
        case 'delete': return 'Delete'
        case 'grep': return 'Grep'
        case 'find': return 'Find'
        case 'web-search': return 'Web search'
        case 'lints': return 'Lints'
        case 'todos': return 'Todos'
        case 'mcp': return 'MCP'
        case 'plan': return 'Plan'
        default: return toolName.length > 48 ? `${toolName.slice(0, 45)}…` : toolName
    }
}

/** Truncated command detail for shell-like tools (null for non-shell). */
export function flowToolDetail(toolName: string, input?: unknown): string | null {
    if (!isShellLikeToolName(toolName)) {
        const path = extractToolFilePath(toolName, input)
        return path
    }
    const fromInput = getInputStringAny(input, ['command', 'cmd'])
    let cmd = fromInput ?? toolName
    if (cmd.startsWith('`') && cmd.endsWith('`')) cmd = cmd.slice(1, -1)
    if (cmd.startsWith('`')) cmd = cmd.slice(1)
    cmd = cmd.replace(/\s+/g, ' ').trim()
    if (cmd.length <= 72) return cmd
    return `${cmd.slice(0, 69)}…`
}

/** Extracts the file path from a tool's input, honoring tool-specific key variance. Null if none. */
export function extractToolFilePath(toolName: string, input: unknown): string | null {
    const keys = toolName.startsWith('Notebook') ? NOTEBOOK_KEYS : PATH_KEYS
    const path = getInputStringAny(input, keys)
    if (!path) return null
    // Cursor ACP sometimes echoes the tool title into file_path ("Read File").
    if (path === toolName) return null
    if (path === 'Read File' || path === 'Edit File' || path === 'Write File' || path === 'Delete File') return null
    return path
}

export type FileTouch = {
    path: string
    reads: number
    writes: number
    deletes: number
    total: number
}

export type FileActivity = {
    reads: number
    writes: number
    deletes: number
    /** Calls classified as file tools that had no usable path in input. */
    pathless: number
    total: number
}

/**
 * Accumulates file touches across an arbitrary traversal. Consumers call
 * `add(toolName, input)` for every tool call they encounter; non-file tools and
 * path-less inputs are ignored for path ranking (but still counted in activity).
 */
export class FileTouchAccumulator {
    private readonly byPath = new Map<string, FileTouch>()
    private readonly activity: FileActivity = {
        reads: 0,
        writes: 0,
        deletes: 0,
        pathless: 0,
        total: 0,
    }

    add(toolName: string, input: unknown): void {
        const kind = classifyFileTool(toolName)
        if (!kind) return
        this.activity.total++
        if (kind === 'write') this.activity.writes++
        else if (kind === 'delete') this.activity.deletes++
        else this.activity.reads++

        const path = extractToolFilePath(toolName, input)
        if (!path) {
            this.activity.pathless++
            return
        }
        const cur = this.byPath.get(path) ?? { path, reads: 0, writes: 0, deletes: 0, total: 0 }
        if (kind === 'write') cur.writes++
        else if (kind === 'delete') cur.deletes++
        else cur.reads++
        cur.total++
        this.byPath.set(path, cur)
    }

    result(): FileTouch[] {
        return [...this.byPath.values()].sort(
            (a, b) => b.total - a.total || b.writes - a.writes || a.path.localeCompare(b.path),
        )
    }

    activitySummary(): FileActivity {
        return { ...this.activity }
    }
}
