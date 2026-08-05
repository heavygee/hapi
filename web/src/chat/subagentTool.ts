/**
 * Returns true when the tool name identifies a subagent invocation.
 *
 * The Claude Code SDK has used two names for the same concept:
 *   - 'Task'  — earlier SDK releases
 *   - 'Agent' — later SDK releases (OPUS 4.7+ environment)
 *
 * Both share the same input shape: { prompt: string, subagent_type: string }.
 * The tracer, reducer, and UI surfaces must treat them identically.
 * Keeping both ensures sessions recorded under either name continue to work.
 *
 * Cursor ACP adds:
 *   - 'CursorTask' — extension notification (`cursor/task`) with title/description
 *   - 'Task: …'    — ACP tool title prefix (often "Task: Subagent task") that is
 *                    later enriched by CursorTask on the same callId
 */
export function isSubagentToolName(name: string): boolean {
    return (
        name === 'Task'
        || name === 'Agent'
        || name === 'CursorTask'
        || name.startsWith('Agent:')
        || name.startsWith('Task:')
    )
}

/** Human label for a subagent tool (prefers CursorTask title/description). */
export function subagentFlowLabel(name: string, input: unknown): string {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>
        for (const key of ['title', 'description'] as const) {
            const value = obj[key]
            if (typeof value === 'string') {
                const trimmed = value.trim()
                if (trimmed.length > 0) return trimmed
            }
        }
    }
    if (name === 'CursorTask' || name === 'Task' || name === 'Agent' || name.startsWith('Task:')) {
        return 'Subagent'
    }
    return name
}

/** Optional secondary line for a subagent (model · duration). */
export function subagentFlowDetail(input: unknown): string | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const obj = input as Record<string, unknown>
    const parts: string[] = []
    if (typeof obj.model === 'string' && obj.model.trim()) parts.push(obj.model.trim())
    const durationMs = typeof obj.durationMs === 'number'
        ? obj.durationMs
        : typeof obj.duration_ms === 'number'
            ? obj.duration_ms
            : null
    if (durationMs != null && durationMs > 0) {
        if (durationMs < 1000) parts.push(`${Math.round(durationMs)}ms`)
        else if (durationMs < 60_000) parts.push(`${(durationMs / 1000).toFixed(1)}s`)
        else parts.push(`${Math.round(durationMs / 60_000)}m`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
}
