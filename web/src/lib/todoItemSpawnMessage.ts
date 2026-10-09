import type { TodoBoardItem } from '@/types/api'

// Keeps the whole message comfortably under practical URL length limits
// (it travels as a `/sessions/new` search param, not a dedicated transfer
// mechanism — see router.tsx's `initialMessage`) even for a long issue body.
const MAX_BODY_LENGTH = 1000

/**
 * Builds the composer "briefing" text for a session spawned from a to-do
 * item (hapi#235/#238). This seeds the first message only — the structured,
 * persisted link (metadata.externalRefs, surfaced as an IssueRefChip) is a
 * separate step the caller (router.tsx's handleSpawnFromTodoItem) triggers
 * after the session is created.
 */
export function buildTodoItemSpawnMessage(item: TodoBoardItem): string {
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
