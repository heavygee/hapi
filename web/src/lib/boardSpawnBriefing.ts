import { randomId } from '@/lib/randomId'

const STORAGE_PREFIX = 'hapi:board-spawn-briefing:'

export type BoardSpawnBriefing = {
    message: string
    linkIssueUrl?: string
}

/**
 * The board item's briefing — the instruction message delivered to the
 * spawned session (buildBoardItemSpawnMessage) plus the issue URL to
 * auto-link — used to travel as `/sessions/new` search params — browser
 * history, same-origin referrer/access logs, and the URL bar itself then
 * carried private board content (hapi#238 Codex review). Stashed in
 * sessionStorage instead, keyed by an opaque transfer id that's the only
 * thing placed in the URL — same shape as `shareTransferId`, but local-only
 * (no hub round trip needed).
 *
 * Deliberately a peek/clear pair, not a delete-on-read "take": the spawn flow
 * can detour through /browse and back to `/sessions/new` with the same id
 * (same pattern as `shareTransferId`) before the session is actually
 * created, so `NewSessionPage` must be able to re-read it on each mount.
 * Call `clearBoardSpawnBriefing` once the flow actually completes or is
 * cancelled, so the stash doesn't accumulate across spawns.
 */
export function stashBoardSpawnBriefing(briefing: BoardSpawnBriefing): string {
    const id = randomId()
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(briefing))
        } catch {
            // sessionStorage unavailable (private mode, quota) — the id is
            // still returned so the flow degrades to "spawn with no briefing"
            // rather than throwing.
        }
    }
    return id
}

export function peekBoardSpawnBriefing(id: string): BoardSpawnBriefing | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = sessionStorage.getItem(STORAGE_PREFIX + id)
        if (!raw) return null
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object') return null
        const { message, linkIssueUrl } = parsed as Record<string, unknown>
        if (typeof message !== 'string') return null
        return {
            message,
            linkIssueUrl: typeof linkIssueUrl === 'string' ? linkIssueUrl : undefined
        }
    } catch {
        return null
    }
}

export function clearBoardSpawnBriefing(id: string): void {
    if (typeof window === 'undefined') return
    try {
        sessionStorage.removeItem(STORAGE_PREFIX + id)
    } catch {
        // Best-effort cleanup only.
    }
}
