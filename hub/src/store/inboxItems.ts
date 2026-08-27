import type { Database } from 'bun:sqlite'
import {
    buildExplainPriority,
    buildInboxTitleFromEvent,
    computeCoarseBasePriority,
    isActiveInboxStatus,
    mapEventTypeToInboxCategory,
    mapOperatorActionToStatus,
    type InboxOperatorAction
} from '@hapi/protocol'
import type { StoredSystemEvent } from './events'
import { getSystemEventById, listSystemEvents } from './events'

export type StoredInboxItem = {
    id: number
    status: string
    priority: number
    basePriority: number
    agingFactor: number | null
    timeCriticality: number | null
    decayAfter: number | null
    reasonForPriority: string | null
    sourceEventIds: number[]
    relatedInboxIds: number[]
    artifactRefs: string | null
    suggestedAction: string | null
    deadline: number | null
    operatorFeedback: string | null
    surfacedAt: number | null
    resolvedAt: number | null
    snoozedUntil: number | null
    attentionClass: string
    breakpointClass: string | null
    createdAt: number
    updatedAt: number
    relatedSessionId: string | null
    title: string
    category: string
    summary: string
}

export type StoredInboxOperatorAction = {
    id: number
    inboxItemId: number
    action: InboxOperatorAction
    statusAfter: string
    feedback: string | null
    createdAt: number
}

export type ListInboxItemsOptions = {
    limit?: number
    activeOnly?: boolean
    sessionId?: string | null
    /** Explicit status allow-list (overrides activeOnly when set). */
    statuses?: string[] | null
    category?: string | null
}

type InboxItemRow = {
    id: number
    status: string
    priority: number
    base_priority: number
    aging_factor: number | null
    time_criticality: number | null
    decay_after: number | null
    reason_for_priority: string | null
    source_event_ids: string | null
    related_inbox_ids: string | null
    artifact_refs: string | null
    suggested_action: string | null
    deadline: number | null
    operator_feedback: string | null
    surfaced_at: number | null
    resolved_at: number | null
    snoozed_until: number | null
    attention_class: string
    breakpoint_class: string | null
    created_at: number
    updated_at: number
    related_session_id: string | null
    title: string
    category: string
    summary: string
}

function parseIdArray(raw: string | null | undefined): number[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.filter((value): value is number => typeof value === 'number')
    } catch {
        return []
    }
}

function mapRow(row: InboxItemRow): StoredInboxItem {
    return {
        id: row.id,
        status: row.status,
        priority: row.priority,
        basePriority: row.base_priority,
        agingFactor: row.aging_factor,
        timeCriticality: row.time_criticality,
        decayAfter: row.decay_after,
        reasonForPriority: row.reason_for_priority,
        sourceEventIds: parseIdArray(row.source_event_ids),
        relatedInboxIds: parseIdArray(row.related_inbox_ids),
        artifactRefs: row.artifact_refs,
        suggestedAction: row.suggested_action,
        deadline: row.deadline,
        operatorFeedback: row.operator_feedback,
        surfacedAt: row.surfaced_at,
        resolvedAt: row.resolved_at,
        snoozedUntil: row.snoozed_until,
        attentionClass: row.attention_class,
        breakpointClass: row.breakpoint_class,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        relatedSessionId: row.related_session_id,
        title: row.title,
        category: row.category,
        summary: row.summary
    }
}

function syncSourceEventLinks(db: Database, inboxItemId: number, eventIds: number[]): void {
    db.prepare('DELETE FROM inbox_item_source_events WHERE inbox_item_id = ?').run(inboxItemId)
    const insert = db.prepare(
        'INSERT OR IGNORE INTO inbox_item_source_events (inbox_item_id, event_id) VALUES (?, ?)'
    )
    for (const eventId of eventIds) {
        insert.run(inboxItemId, eventId)
    }
}

/** Clear session FK refs so DELETE FROM sessions succeeds (items are audit-retained). */
export function detachSessionInboxItems(db: Database, sessionId: string): number {
    const result = db.prepare(
        'UPDATE inbox_items SET related_session_id = NULL WHERE related_session_id = ?'
    ).run(sessionId)
    return result.changes
}

export function repointSessionInboxItems(db: Database, fromSessionId: string, toSessionId: string): number {
    if (fromSessionId === toSessionId) return 0
    const countRow = db.prepare(
        'SELECT COUNT(*) as count FROM inbox_items WHERE related_session_id = ?'
    ).get(fromSessionId) as { count: number }
    const pending = countRow.count
    if (pending === 0) return 0
    db.prepare(
        'UPDATE inbox_items SET related_session_id = ? WHERE related_session_id = ?'
    ).run(toSessionId, fromSessionId)
    return pending
}

export function getInboxItemById(db: Database, id: number): StoredInboxItem | null {
    const row = db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id) as InboxItemRow | undefined
    return row ? mapRow(row) : null
}

export function countInboxItems(db: Database): number {
    const row = db.prepare('SELECT COUNT(*) AS count FROM inbox_items').get() as { count: number }
    return row.count
}

export function listInboxItems(db: Database, options: ListInboxItemsOptions = {}): StoredInboxItem[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const clauses: string[] = []
    const params: Array<string | number> = []

    if (options.statuses && options.statuses.length > 0) {
        const placeholders = options.statuses.map(() => '?').join(', ')
        clauses.push(`status IN (${placeholders})`)
        params.push(...options.statuses)
    } else if (options.activeOnly) {
        clauses.push("status IN ('new', 'surfaced', 'deferred', 'snoozed')")
    }
    if (options.sessionId) {
        clauses.push('related_session_id = ?')
        params.push(options.sessionId)
    }
    if (options.category) {
        clauses.push('category = ?')
        params.push(options.category)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(
        `SELECT * FROM inbox_items ${where}
         ORDER BY base_priority ASC, created_at ASC
         LIMIT ?`
    ).all(...params, limit) as InboxItemRow[]

    return rows.map(mapRow)
}

export function findActiveInboxItemForSession(db: Database, sessionId: string): StoredInboxItem | null {
    const row = db.prepare(`
        SELECT * FROM inbox_items
        WHERE related_session_id = ?
          AND status IN ('new', 'surfaced', 'deferred', 'snoozed')
        ORDER BY updated_at DESC
        LIMIT 1
    `).get(sessionId) as InboxItemRow | undefined
    return row ? mapRow(row) : null
}

export function promoteAttentionEvent(
    db: Database,
    event: StoredSystemEvent
): StoredInboxItem | null {
    if (event.attentionCandidate !== 1) return null
    if (!event.relatedSessionId) return null

    const now = Date.now()
    const category = mapEventTypeToInboxCategory(event.eventType)
    const basePriority = computeCoarseBasePriority(event.eventType, event.sourceKind)
    const title = buildInboxTitleFromEvent(event.artifactRefs, event.payloadJson, event.summary)
    const suggestedAction = extractSuggestedAction(event.payloadJson)
    const existing = findActiveInboxItemForSession(db, event.relatedSessionId)

    const sourceEventIds = existing
        ? Array.from(new Set([...existing.sourceEventIds, event.id]))
        : [event.id]

    const reasonForPriority = buildExplainPriority(category, existing?.createdAt ?? event.ts, sourceEventIds, now)

    if (existing) {
        db.prepare(`
            UPDATE inbox_items SET
                status = 'surfaced',
                priority = ?,
                base_priority = ?,
                reason_for_priority = ?,
                source_event_ids = ?,
                artifact_refs = COALESCE(?, artifact_refs),
                suggested_action = COALESCE(?, suggested_action),
                title = ?,
                category = ?,
                summary = ?,
                updated_at = ?,
                surfaced_at = COALESCE(surfaced_at, ?)
            WHERE id = ?
        `).run(
            basePriority,
            basePriority,
            reasonForPriority,
            JSON.stringify(sourceEventIds),
            event.artifactRefs,
            suggestedAction,
            title,
            category,
            event.summary,
            now,
            now,
            existing.id
        )
        syncSourceEventLinks(db, existing.id, sourceEventIds)
        return getInboxItemById(db, existing.id)
    }

    const insert = db.prepare(`
        INSERT INTO inbox_items (
            status, priority, base_priority, aging_factor, time_criticality, decay_after,
            reason_for_priority, source_event_ids, related_inbox_ids, artifact_refs,
            suggested_action, deadline, operator_feedback, surfaced_at, resolved_at,
            snoozed_until, attention_class, breakpoint_class, created_at, updated_at,
            related_session_id, title, category, summary
        ) VALUES (
            'new', ?, ?, NULL, NULL, NULL,
            ?, ?, '[]', ?,
            ?, NULL, NULL, ?, NULL,
            NULL, 'live', NULL, ?, ?,
            ?, ?, ?, ?
        )
    `)

    const result = insert.run(
        basePriority,
        basePriority,
        reasonForPriority,
        JSON.stringify(sourceEventIds),
        event.artifactRefs,
        suggestedAction,
        now,
        event.ts,
        now,
        event.relatedSessionId,
        title,
        category,
        event.summary
    )

    const id = Number(result.lastInsertRowid)
    syncSourceEventLinks(db, id, sourceEventIds)
    return getInboxItemById(db, id)
}

export function recordInboxOperatorAction(
    db: Database,
    inboxItemId: number,
    action: InboxOperatorAction,
    feedback: string | null = null,
    snoozedUntil: number | null = null
): StoredInboxItem | null {
    const item = getInboxItemById(db, inboxItemId)
    if (!item) return null

    const now = Date.now()
    const statusAfter = mapOperatorActionToStatus(action)
    db.prepare(`
        INSERT INTO inbox_operator_actions (inbox_item_id, action, status_after, feedback, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(inboxItemId, action, statusAfter, feedback, now)

    const resolvedAt = statusAfter === 'resolved' || statusAfter === 'obsoleted' ? now : null
    db.prepare(`
        UPDATE inbox_items SET
            status = ?,
            operator_feedback = ?,
            updated_at = ?,
            snoozed_until = ?,
            resolved_at = COALESCE(?, resolved_at)
        WHERE id = ?
    `).run(statusAfter, feedback, now, snoozedUntil, resolvedAt, inboxItemId)

    return getInboxItemById(db, inboxItemId)
}

function extractSuggestedAction(payloadJson: string | null): string | null {
    if (!payloadJson) return null
    try {
        const payload = JSON.parse(payloadJson) as { suggested_action?: unknown; notify_summary?: { action?: unknown } }
        if (typeof payload.suggested_action === 'string' && payload.suggested_action.trim()) {
            return payload.suggested_action.trim()
        }
        if (typeof payload.notify_summary?.action === 'string' && payload.notify_summary.action.trim()) {
            return payload.notify_summary.action.trim()
        }
    } catch {
        return null
    }
    return null
}

/**
 * Idempotent backfill — re-derive `title` + `base_priority`/`priority` for
 * existing inbox rows from their latest source event. Deterministic (pure
 * functions of the event + artifact refs) and touches only title/priority
 * (never status/resolution/feedback), so it is safe to run on every boot.
 *
 * Repairs rows promoted before the title-synthesis + channel-priority-band
 * changes (bare-PR-URL titles at worker-band priority) without waiting for the
 * next PR transition to re-promote them. A no-op once every row already matches.
 */
export function backfillInboxDerivedFields(db: Database): void {
    const rows = db.prepare(
        'SELECT id, title, base_priority, artifact_refs, summary, source_event_ids FROM inbox_items'
    ).all() as Array<{
        id: number
        title: string
        base_priority: number
        artifact_refs: string | null
        summary: string
        source_event_ids: string | null
    }>
    if (rows.length === 0) return

    const update = db.prepare(
        'UPDATE inbox_items SET title = ?, base_priority = ?, priority = ? WHERE id = ?'
    )
    for (const row of rows) {
        const eventIds = parseIdArray(row.source_event_ids)
        const latestId = eventIds.length > 0 ? Math.max(...eventIds) : null
        const latest = latestId !== null ? getSystemEventById(db, latestId) : null

        // Only recompute the title when we have material to derive it from,
        // so a row with a good session-name title and a since-deleted event
        // is never regressed to its summary.
        let nextTitle = row.title
        if (latest || row.artifact_refs) {
            nextTitle = buildInboxTitleFromEvent(
                row.artifact_refs ?? latest?.artifactRefs ?? null,
                latest?.payloadJson ?? null,
                row.summary
            )
        }
        const nextPriority = latest
            ? computeCoarseBasePriority(latest.eventType, latest.sourceKind)
            : row.base_priority

        if (nextTitle === row.title && nextPriority === row.base_priority) continue
        update.run(nextTitle, nextPriority, nextPriority, row.id)
    }
}

/**
 * How long a terminal (FINALE / completed) item stays on the active attention
 * surface before it auto-resolves. A completed item is "nothing more to do —
 * the only relevance is that it happened" (operator, 2026-07-31), so it is
 * context, not attention. Keep it visible briefly, then get it out of the way.
 */
export const FINALE_DECAY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Auto-resolve decayed terminal (completed) inbox items so a backlog of finished
 * work stops crowding the operator's attention surface. Rows are RETAINED as
 * history — status leaves the active set, never deleted.
 *
 * Only FINALE (completed) is swept, and only once it has sat past the decay
 * window.
 *
 * STALE is deliberately NOT swept here. The hub-inferred "No agent output for N
 * minutes" silence detection was retired (see
 * `OverseerEventRecorder.checkStaleSessions`, now returns []; last such event on
 * the live DB was 2026-07-17) — but a worker that self-reports status:"stalled"
 * via AGENT_NOTIFY_SUMMARY ALSO lands as `event_type='stale'` → category STALE,
 * and that is a live, operator-relevant signal (observed as recently as 3 days
 * before this was written). Blanket-obsoleting STALE would eat those self-
 * reports. Historical hub-inferred STALE cruft is a separate operator-approved
 * one-shot, not this live sweep.
 *
 * Idempotent: matches only active rows, so re-running changes nothing once swept.
 * Returns the number of rows resolved.
 */
export function sweepDecayedTerminalItems(
    db: Database,
    now: number = Date.now(),
    windowMs: number = FINALE_DECAY_WINDOW_MS
): number {
    const result = db.prepare(
        `UPDATE inbox_items
            SET status = 'resolved', resolved_at = ?, updated_at = ?
          WHERE status IN ('new', 'surfaced', 'deferred', 'snoozed')
            AND category = 'FINALE' AND updated_at < ?`
    ).run(now, now, now - windowMs)
    return result.changes
}

/**
 * Idempotent Overseer inbox DDL — runs on every Store init, NOT gated on SCHEMA_VERSION.
 */
export function ensureOverseerInboxSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS inbox_items (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL,
            priority REAL NOT NULL,
            base_priority REAL NOT NULL,
            aging_factor REAL,
            time_criticality REAL,
            decay_after INTEGER,
            reason_for_priority TEXT,
            source_event_ids TEXT,
            related_inbox_ids TEXT,
            artifact_refs TEXT,
            suggested_action TEXT,
            deadline INTEGER,
            operator_feedback TEXT,
            surfaced_at INTEGER,
            resolved_at INTEGER,
            snoozed_until INTEGER,
            attention_class TEXT NOT NULL DEFAULT 'live',
            breakpoint_class TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            related_session_id TEXT REFERENCES sessions(id),
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            summary TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_items_session ON inbox_items(related_session_id);
        CREATE INDEX IF NOT EXISTS idx_inbox_items_queue ON inbox_items(status, base_priority, created_at);

        CREATE TABLE IF NOT EXISTS inbox_item_source_events (
            inbox_item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
            event_id INTEGER NOT NULL REFERENCES events(id),
            PRIMARY KEY (inbox_item_id, event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_item_source_events_event ON inbox_item_source_events(event_id);

        CREATE TABLE IF NOT EXISTS inbox_operator_actions (
            id INTEGER PRIMARY KEY,
            inbox_item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            status_after TEXT NOT NULL,
            feedback TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_operator_actions_item ON inbox_operator_actions(inbox_item_id, created_at DESC);
    `)

    backfillInboxDerivedFields(db)
    sweepDecayedTerminalItems(db)
}

export function dropOverseerInboxSchema(db: Database): void {
    db.exec(`
        DROP INDEX IF EXISTS idx_inbox_operator_actions_item;
        DROP TABLE IF EXISTS inbox_operator_actions;
        DROP INDEX IF EXISTS idx_inbox_item_source_events_event;
        DROP TABLE IF EXISTS inbox_item_source_events;
        DROP INDEX IF EXISTS idx_inbox_items_queue;
        DROP INDEX IF EXISTS idx_inbox_items_session;
        DROP TABLE IF EXISTS inbox_items;
    `)
}

export { isActiveInboxStatus, listSystemEvents, getSystemEventById }
