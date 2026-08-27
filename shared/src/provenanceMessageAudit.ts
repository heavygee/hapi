/**
 * Pure helpers for doctor provenance message audit (#1203 operator tooling).
 * Matches web {@link isPeerDeliveryMeta} / unverified PeerSenderChip rules.
 */

const SESSION_UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FROM_SESSION_RE = new RegExp(
    `^From:\\s*/sessions/(${SESSION_UUID_RE})`,
    'i'
)
const FROM_PEER_UNATTR_RE = /^From:\s*peer\s*\(unattributed\)\s*$/i

export const DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS = 7
export const DEFAULT_PROVENANCE_MESSAGE_LIMIT = 50
export const DEFAULT_PROVENANCE_MESSAGE_MAX_SCAN = 5_000

export type ProvenanceMessageScanOptions = {
    /** Only consider messages with created_at >= sinceMs. */
    sinceMs: number
    /** Max unverified rows returned. */
    limit: number
    /** Safety cap on rows decoded per scan. */
    maxScan: number
}

export function defaultProvenanceMessageScanOptions(now: number = Date.now()): ProvenanceMessageScanOptions {
    return {
        sinceMs: now - DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS * 24 * 60 * 60 * 1000,
        limit: DEFAULT_PROVENANCE_MESSAGE_LIMIT,
        maxScan: DEFAULT_PROVENANCE_MESSAGE_MAX_SCAN,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function messageMeta(content: unknown): Record<string, unknown> | null {
    if (!isRecord(content)) return null
    const meta = content.meta
    return isRecord(meta) ? meta : null
}

/** Hub-trusted peer delivery without attributed source session. */
export function isUnverifiedPeerInbound(content: unknown): boolean {
    if (!isRecord(content)) return false
    const meta = messageMeta(content)
    if (!meta || meta.sentFrom !== 'peer') return false
    if (content.role !== 'user') return false
    const peer = isRecord(meta.peer) ? meta.peer : null
    const sourceSessionId = typeof peer?.sourceSessionId === 'string' ? peer.sourceSessionId.trim() : ''
    return !sourceSessionId
}

function extractInboundUserText(content: unknown): string {
    if (!isRecord(content)) return ''
    const inner = content.content
    let text = ''
    if (typeof inner === 'string') {
        text = inner
    } else if (isRecord(inner) && typeof inner.text === 'string') {
        text = inner.text
    } else if (Array.isArray(inner)) {
        for (const block of inner) {
            if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
                text = block.text
                break
            }
        }
    }
    return text
}

export function extractInboundUserTextPreview(content: unknown, maxLen = 120): string {
    const normalized = extractInboundUserText(content).replace(/\s+/g, ' ').trim()
    if (normalized.length <= maxLen) return normalized
    return `${normalized.slice(0, maxLen - 1)}…`
}

/** Client prose From: stamp in message body (display-only; not hub-trusted). */
export function hasClaimedPeerHeaderInText(content: unknown): boolean {
    const text = extractInboundUserText(content)
    if (!text) return false
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    let i = 0
    while (i < lines.length && lines[i]?.trim() === '') i += 1
    const firstLine = lines[i]?.trim() ?? ''
    return FROM_SESSION_RE.test(firstLine) || FROM_PEER_UNATTR_RE.test(firstLine)
}
