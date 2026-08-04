/**
 * Session-row helpers shared by SessionList / SessionRowSummary.
 *
 * Soup remat conflict residue has repeatedly deleted local `getTodoProgress`
 * (and related helpers) from SessionList while leaving call sites — dogfood
 * dies with `getTodoProgress is not defined`. Keep definitions HERE so a
 * SessionList-only merge cannot remove the only binding.
 *
 * See docs/tooling/driver-soup.md § SessionList hot-conflict.
 */
import type { SessionSummary } from '@/types/api'
import { getCodexImportedAt } from '@/lib/codexImportedSessions'
import { formatRelativeTime } from '@/lib/relativeTime'

export function getTodoProgress(
    session: SessionSummary,
): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function formatCodexImportedRelativeTime(
    value: number,
    t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.importedFromCodex.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.importedFromCodex.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.importedFromCodex.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.importedFromCodex.daysAgo', { n: days })
    return formatRelativeTime(value, t)
}

export function getSessionTimeLabel(
    session: SessionSummary,
    t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
    const codexSessionId = session.metadata?.agentSessionId
    const importedAt = session.metadata?.flavor === 'codex'
        ? getCodexImportedAt(codexSessionId)
        : null

    // Prefer Codex import age while the import marker is still set; once the
    // operator continues in Hapi the send path clears the marker and updatedAt wins.
    if (importedAt !== null) {
        return formatCodexImportedRelativeTime(importedAt, t)
    }

    return formatRelativeTime(session.updatedAt, t)
}
