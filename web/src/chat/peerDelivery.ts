export type PeerDeliveryInfo = {
    sourceSessionId?: string
    sourceName?: string
}

/** Client-stamped From: claim in message text (forgeable — UI-only). */
export type ClaimedPeerFromText = {
    sessionId?: string
    name?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

/** True when message meta marks peer/CLI delivery (#1203). */
export function isPeerDeliveryMeta(meta: unknown): boolean {
    if (!isRecord(meta)) return false
    return meta.sentFrom === 'peer'
}

export function getPeerDeliveryInfo(meta: unknown): PeerDeliveryInfo | null {
    if (!isPeerDeliveryMeta(meta) || !isRecord(meta)) return null
    const peer = isRecord(meta.peer) ? meta.peer : null
    const sourceSessionId = typeof peer?.sourceSessionId === 'string' && peer.sourceSessionId.trim()
        ? peer.sourceSessionId.trim()
        : undefined
    const sourceName = typeof peer?.sourceName === 'string' && peer.sourceName.trim()
        ? peer.sourceName.trim()
        : undefined
    return { sourceSessionId, sourceName }
}

const SESSION_UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FROM_SESSION_RE = new RegExp(
    `^From:\\s*/sessions/(${SESSION_UUID_RE})(?:\\s*\\(([^\\)]*)\\))?\\s*$`,
    'i'
)
const FROM_PEER_UNATTR_RE = /^From:\s*peer\s*\(unattributed\)\s*$/i
const NAME_LINE_RE = /^Name:\s*(.+)\s*$/i

/**
 * Parse leading agent/CLI identity stamps from peer message text.
 * Display-only — never treat as hub-trusted provenance.
 */
export function parseClaimedPeerFromText(text: string): ClaimedPeerFromText | null {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    let i = 0
    while (i < lines.length && lines[i].trim() === '') i += 1
    if (i >= lines.length) return null

    const fromLine = lines[i].trim()
    if (FROM_PEER_UNATTR_RE.test(fromLine)) {
        return {}
    }
    const fromMatch = FROM_SESSION_RE.exec(fromLine)
    if (!fromMatch) return null

    const sessionId = fromMatch[1]
    let name = fromMatch[2]?.trim() || undefined
    i += 1
    if (i < lines.length) {
        const nameMatch = NAME_LINE_RE.exec(lines[i].trim())
        if (nameMatch) {
            name = nameMatch[1].trim() || name
            i += 1
        }
    }
    return { sessionId, name }
}

/**
 * Strip leading From:/Name: stamp lines so the bubble does not repeat what the
 * peer chip already shows.
 */
export function stripClaimedPeerHeaderForDisplay(text: string): string {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    let i = 0
    while (i < lines.length && lines[i].trim() === '') i += 1
    if (i >= lines.length) return text

    const fromLine = lines[i].trim()
    const isFrom = FROM_SESSION_RE.test(fromLine) || FROM_PEER_UNATTR_RE.test(fromLine)
    if (!isFrom) return text
    i += 1
    if (i < lines.length && NAME_LINE_RE.test(lines[i].trim())) {
        i += 1
    }
    while (i < lines.length && lines[i].trim() === '') i += 1
    return lines.slice(i).join('\n')
}
