/**
 * Sidebar-style project label for a directory path (last two segments).
 * Shared by SessionList grouping and session-header metadata.
 */
export function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export type SessionProjectLabelSource = {
    path?: string | null
    worktree?: {
        basePath?: string | null
        branch?: string | null
        name?: string | null
        worktreePath?: string | null
    } | null
}

/**
 * Project identity for the session header / sidebar: worktree basePath when
 * present, otherwise metadata.path. Never uses worktreePath (checkout dir).
 */
export function resolveSessionProjectLabel(source: SessionProjectLabelSource): string | null {
    const raw = source.worktree?.basePath?.trim() || source.path?.trim() || ''
    if (!raw) return null
    return getGroupDisplayName(raw)
}
