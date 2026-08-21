import type { Database } from 'bun:sqlite'
import type {
    ProvenanceMessageScanMeta,
    UnverifiedPeerMessageRow,
} from '@hapi/protocol/provenanceDiagnostics'
import type { ProvenanceMessageScanOptions } from '@hapi/protocol/provenanceMessageAudit'
import {
    extractInboundUserTextPreview,
    hasClaimedPeerHeaderInText,
    isUnverifiedPeerInbound,
} from '@hapi/protocol/provenanceMessageAudit'
import { decodeMessageContent } from './contentCodec'

type ScanRow = {
    id: string
    session_id: string
    seq: number
    created_at: number
    content: string | Uint8Array
    metadata: string | null
}

function sessionNameFromMetadata(metadata: string | null): string | null {
    if (!metadata) return null
    try {
        const parsed = JSON.parse(metadata) as { name?: unknown }
        return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
    } catch {
        return null
    }
}

export type ScanUnverifiedPeerMessagesResult = {
    rows: UnverifiedPeerMessageRow[]
    meta: ProvenanceMessageScanMeta
}

export function scanUnverifiedPeerMessages(
    db: Database,
    namespace: string,
    options: ProvenanceMessageScanOptions
): ScanUnverifiedPeerMessagesResult {
    const stmt = db.prepare(`
        SELECT m.id, m.session_id, m.seq, m.created_at, m.content, s.metadata
        FROM messages m
        INNER JOIN sessions s ON s.id = m.session_id AND s.namespace = ?
        WHERE m.created_at >= ?
        ORDER BY m.created_at DESC
        LIMIT ?
    `)

    const candidates = stmt.all(namespace, options.sinceMs, options.maxScan) as ScanRow[]
    const rows: UnverifiedPeerMessageRow[] = []
    let unverifiedTotal = 0

    for (const row of candidates) {
        const decoded = decodeMessageContent(row.content)
        if (!isUnverifiedPeerInbound(decoded)) {
            continue
        }
        unverifiedTotal += 1
        if (rows.length >= options.limit) {
            continue
        }
        rows.push({
            messageId: row.id,
            sessionId: row.session_id,
            sessionName: sessionNameFromMetadata(row.metadata),
            seq: row.seq,
            createdAt: row.created_at,
            textPreview: extractInboundUserTextPreview(decoded),
            claimedPeerHeaderInText: hasClaimedPeerHeaderInText(decoded),
        })
    }

    return {
        rows,
        meta: {
            sinceMs: options.sinceMs,
            limit: options.limit,
            maxScan: options.maxScan,
            messagesScanned: candidates.length,
            unverifiedTotal,
            scanTruncated: candidates.length >= options.maxScan,
        },
    }
}
