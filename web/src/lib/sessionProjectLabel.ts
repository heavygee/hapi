import { getPathDisplayName } from '@/utils/path'

export type SessionProjectMetadata = {
    path?: string | null
    worktree?: {
        basePath?: string | null
    } | null
}

/** Use the repository path for worktrees and the session path otherwise. */
export function getSessionProjectPath(metadata: SessionProjectMetadata | null | undefined): string | null {
    if (metadata?.worktree) {
        return metadata.worktree.basePath?.trim() || null
    }
    return metadata?.path?.trim() || null
}

/** Match the compact project labels used by the session sidebar. */
export function getSessionProjectLabel(directory: string): string {
    return getPathDisplayName(directory)
}

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
