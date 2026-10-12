import type { BoardItem } from '@/types/api'

// Caps how much of a long issue body gets seeded into the first composer
// message, independent of transport — the briefing travels via
// sessionStorage (lib/boardSpawnBriefing.ts), not the URL.
const MAX_BODY_LENGTH = 1000

/**
 * Builds the composer "briefing" text for a session spawned from a to-do
 * item (hapi#235/#238). This seeds the first message only — the structured,
 * persisted link (metadata.externalRefs, surfaced as an IssueRefChip) is a
 * separate step the caller (router.tsx's handleSpawnFromBoardItem) triggers
 * after the session is created.
 */
export function buildBoardItemSpawnMessage(item: BoardItem): string {
    const heading = item.number !== null ? `${item.title} (#${item.number})` : item.title
    const lines = [heading]
    if (item.url) {
        lines.push(item.url)
    }
    if (item.body) {
        const trimmedBody = item.body.trim()
        if (trimmedBody) {
            const truncated = trimmedBody.length > MAX_BODY_LENGTH
                ? `${trimmedBody.slice(0, MAX_BODY_LENGTH)}…`
                : trimmedBody
            lines.push('', truncated)
        }
    }
    return lines.join('\n')
}
