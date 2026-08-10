import type { Database } from 'bun:sqlite'
import {
    buildExplainPriority,
    buildInboxTitleFromEvent,
    computeCoarseBasePriority,
    isActiveInboxStatus,
    DISPOSITION_PREDICATE_COLUMNS,
    mapEventTypeToInboxCategory,
    mapOperatorActionToStatus,
    parseArtifactRefs,
    pickPrimaryArtifact,
    type ArtifactRef,
    type DispositionPredicateColumn,
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
    /** R8 disposition snapshot — the as-seen predicate vocabulary (also the standing-order match keys). */
    sourceKind: string | null
    sourceRef: string | null
    eventType: string | null
    category: string | null
    project: string | null
    artifactKind: string | null
    repo: string | null
    /** As-seen render/audit blob: title, summary, severity, priorities, provenance, artifactRefs, sourceEventIds. */
    contextSnapshot: DispositionContextSnapshot | null
}

/** As-seen blob frozen on the disposition row (R8) — for tombstone render + audit + future bucket keys. */
export type DispositionContextSnapshot = {
    title: string
    summary: string
    severity: number | null
    basePriority: number
    priority: number
    provenance: string | null
    artifactRefs: string | null
    sourceEventIds: number[]
}

/** The R8 predicate columns + blob, derived once at disposition write time. */
export type DispositionSnapshot = {
    sourceKind: string | null
    sourceRef: string | null
    eventType: string | null
    category: string | null
    project: string | null
    artifactKind: string | null
    repo: string | null
    contextSnapshot: DispositionContextSnapshot
}

export type ListInboxItemsOptions = {
    limit?: number
    activeOnly?: boolean
    sessionId?: string | null
    /** Explicit status allow-list (overrides activeOnly when set). */
    statuses?: string[] | null
    category?: string | null
    /**
     * When true and statuses includes `snoozed`, return still-sleeping rows
     * (explicit "what is snoozed?" queries). Default false: hide sleeping snoozes
     * even if `snoozed` appears in a default status list.
     */
    includeSleepingSnoozed?: boolean
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

/** Wake snoozed items whose sleep window has elapsed (wake-on-read). */
function wakeExpiredSnoozes(db: Database, now: number): void {
    db.prepare(`
        UPDATE inbox_items
        SET status = 'surfaced', snoozed_until = NULL, updated_at = ?
        WHERE status = 'snoozed'
          AND snoozed_until IS NOT NULL
          AND snoozed_until <= ?
    `).run(now, now)
}

/** Exclude items still sleeping: status=snoozed with a future snoozed_until. */
function appendSnoozeVisibilityClause(clauses: string[], params: Array<string | number>, now: number): void {
    clauses.push("(status != 'snoozed' OR snoozed_until IS NULL OR snoozed_until <= ?)")
    params.push(now)
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
    const now = Date.now()
    wakeExpiredSnoozes(db, now)

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const clauses: string[] = []
    const params: Array<string | number> = []

    if (options.statuses && options.statuses.length > 0) {
        const placeholders = options.statuses.map(() => '?').join(', ')
        clauses.push(`status IN (${placeholders})`)
        params.push(...options.statuses)
        // Only an explicit "include sleeping" request returns future snoozes.
        // Default Overseer inbox lists may mention status 'snoozed' but still hide sleepers.
        if (!(options.includeSleepingSnoozed && options.statuses.includes('snoozed'))) {
            appendSnoozeVisibilityClause(clauses, params, now)
        }
    } else if (options.activeOnly) {
        clauses.push("status IN ('new', 'surfaced', 'deferred', 'snoozed')")
        appendSnoozeVisibilityClause(clauses, params, now)
    } else {
        appendSnoozeVisibilityClause(clauses, params, now)
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

/**
 * Visible active item for a session (excludes still-sleeping snoozes).
 * Use for operator-facing inbox views.
 */
export function findActiveInboxItemForSession(db: Database, sessionId: string): StoredInboxItem | null {
    const now = Date.now()
    wakeExpiredSnoozes(db, now)

    const row = db.prepare(`
        SELECT * FROM inbox_items
        WHERE related_session_id = ?
          AND status IN ('new', 'surfaced', 'deferred', 'snoozed')
          AND (status != 'snoozed' OR snoozed_until IS NULL OR snoozed_until <= ?)
        ORDER BY updated_at DESC
        LIMIT 1
    `).get(sessionId, now) as InboxItemRow | undefined
    return row ? mapRow(row) : null
}

/**
 * Dedup lookup for promoteAttentionEvent — includes sleeping snoozed rows so a
 * new attention event during a snooze updates the existing item instead of
 * inserting a second active row for the same session.
 */
export function findInboxItemForSessionDedup(db: Database, sessionId: string): StoredInboxItem | null {
    const now = Date.now()
    wakeExpiredSnoozes(db, now)

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
    const basePriority = computeCoarseBasePriority(event.eventType)
    const title = buildInboxTitleFromEvent(event.artifactRefs, event.payloadJson, event.summary)
    const suggestedAction = extractSuggestedAction(event.payloadJson)
    const existing = findInboxItemForSessionDedup(db, event.relatedSessionId)

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

/** Parse `owner/repo` from an artifact ref (explicit `repo` field, else a GitHub URL). */
function repoFromArtifact(ref: ArtifactRef | undefined): string | null {
    if (!ref) return null
    const explicit = (ref as { repo?: unknown }).repo
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
    const url = typeof ref.url === 'string' ? ref.url : null
    if (!url) return null
    const m = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git|\/|$)/i)
    return m ? m[1] : null
}

/**
 * Freeze the R8 as-seen snapshot for a disposition (write-time). Derived from the item plus its
 * primary (latest) source event. Shared by every DISPOSITION write path — the conversational
 * `record_disposition` now, and standing-order enactments in Phase 3 — so the predicate vocabulary
 * is populated identically regardless of who records the decision.
 *
 * NOT used by F5 auto-decay: `sweepDecayedTerminalItems` is a bulk `UPDATE inbox_items` that never
 * calls `recordInboxOperatorAction`, and deliberately so. `inbox_operator_actions` is a DECISIONS
 * table, not a full status-transition audit — routing mechanical auto-resolve through it would flood
 * discovery with `action='done'` on FINALE and let the GROUP BY "discover" a preference that is just
 * the F5 mechanism (circular). Dispositions = decisions; F5 = plumbing. (`query_events` rehydrates
 * "what happened to X?" for auto-resolved items.)
 */
export function buildDispositionSnapshot(db: Database, item: StoredInboxItem): DispositionSnapshot {
    const primaryEventId = item.sourceEventIds.length
        ? Math.max(...item.sourceEventIds)
        : null
    const event = primaryEventId != null ? getSystemEventById(db, primaryEventId) : null

    let project: string | null = null
    if (event?.payloadJson) {
        try {
            const payload = JSON.parse(event.payloadJson) as { session?: { project?: unknown } }
            if (typeof payload.session?.project === 'string' && payload.session.project.trim()) {
                project = payload.session.project.trim()
            }
        } catch {
            project = null
        }
    }

    // as-seen artifacts prefer the inbox item's snapshot, falling back to the source event.
    // Use the same priority rule as the displayed inbox title (PR > URL, etc.).
    const artifactsRaw = item.artifactRefs ?? event?.artifactRefs ?? null
    const primaryArtifact = pickPrimaryArtifact(parseArtifactRefs(artifactsRaw))

    return {
        sourceKind: event?.sourceKind ?? null,
        sourceRef: event?.sourceRef ?? null,
        eventType: event?.eventType ?? null,
        category: item.category,
        project,
        artifactKind: primaryArtifact?.kind ?? null,
        repo: repoFromArtifact(primaryArtifact ?? undefined),
        contextSnapshot: {
            title: item.title,
            summary: item.summary,
            severity: event?.severity ?? null,
            basePriority: item.basePriority,
            priority: item.priority,
            provenance: event?.provenance ?? null,
            artifactRefs: artifactsRaw,
            sourceEventIds: item.sourceEventIds
        }
    }
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
    const snapshot = buildDispositionSnapshot(db, item)
    db.prepare(`
        INSERT INTO inbox_operator_actions (
            inbox_item_id, action, status_after, feedback, created_at,
            source_kind, source_ref, event_type, category, project, artifact_kind, repo,
            context_snapshot_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        inboxItemId,
        action,
        statusAfter,
        feedback,
        now,
        snapshot.sourceKind,
        snapshot.sourceRef,
        snapshot.eventType,
        snapshot.category,
        snapshot.project,
        snapshot.artifactKind,
        snapshot.repo,
        JSON.stringify(snapshot.contextSnapshot)
    )

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

export type DispositionGroupColumn = DispositionPredicateColumn

export type QueryDispositionsFilter = {
    action?: string | null
    /** When action is unset, restrict to these actions (exclude route/retry noise). */
    actionsAllowlist?: readonly string[] | null
    sourceKind?: string | null
    sourceRef?: string | null
    eventType?: string | null
    category?: string | null
    project?: string | null
    artifactKind?: string | null
    repo?: string | null
    sinceTs?: number | null
    limit?: number
}

/** One cluster from the discovery/GROUP BY mode (R3): the shared row shape + `GROUP BY` + `HAVING count>=N`. */
export type DispositionCluster = {
    keys: Partial<Record<DispositionGroupColumn, string | null>>
    count: number
    /** action -> count within the cluster (so discovery sees the dominant disposition). */
    actions: Record<string, number>
    lastCreatedAt: number
}

type OperatorActionRow = {
    id: number
    inbox_item_id: number
    action: string
    status_after: string
    feedback: string | null
    created_at: number
    source_kind: string | null
    source_ref: string | null
    event_type: string | null
    category: string | null
    project: string | null
    artifact_kind: string | null
    repo: string | null
    context_snapshot_json: string | null
}

function mapOperatorActionRow(row: OperatorActionRow): StoredInboxOperatorAction {
    let contextSnapshot: DispositionContextSnapshot | null = null
    if (row.context_snapshot_json) {
        try {
            contextSnapshot = JSON.parse(row.context_snapshot_json) as DispositionContextSnapshot
        } catch {
            contextSnapshot = null
        }
    }
    return {
        id: row.id,
        inboxItemId: row.inbox_item_id,
        action: row.action as InboxOperatorAction,
        statusAfter: row.status_after,
        feedback: row.feedback,
        createdAt: row.created_at,
        sourceKind: row.source_kind,
        sourceRef: row.source_ref,
        eventType: row.event_type,
        category: row.category,
        project: row.project,
        artifactKind: row.artifact_kind,
        repo: row.repo,
        contextSnapshot
    }
}

function buildDispositionWhere(filter: QueryDispositionsFilter): {
    sql: string
    params: (string | number | null)[]
} {
    const clauses: string[] = []
    const params: (string | number | null)[] = []
    const eq = (col: string, val: string | null | undefined) => {
        if (val != null) {
            clauses.push(`${col} = ?`)
            params.push(val)
        }
    }
    eq('action', filter.action)
    if (!filter.action && filter.actionsAllowlist && filter.actionsAllowlist.length > 0) {
        const placeholders = filter.actionsAllowlist.map(() => '?').join(', ')
        clauses.push(`action IN (${placeholders})`)
        params.push(...filter.actionsAllowlist)
    }
    eq('source_kind', filter.sourceKind)
    eq('source_ref', filter.sourceRef)
    eq('event_type', filter.eventType)
    eq('category', filter.category)
    eq('project', filter.project)
    eq('artifact_kind', filter.artifactKind)
    eq('repo', filter.repo)
    if (filter.sinceTs != null) {
        clauses.push('created_at >= ?')
        params.push(filter.sinceTs)
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

/** List disposition rows (newest first) — the R3 shared reader shape. */
export function listDispositions(
    db: Database,
    filter: QueryDispositionsFilter = {}
): StoredInboxOperatorAction[] {
    const { sql, params } = buildDispositionWhere(filter)
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200))
    const rows = db
        .prepare(
            `SELECT * FROM inbox_operator_actions ${sql} ORDER BY created_at DESC LIMIT ?`
        )
        .all(...params, limit) as OperatorActionRow[]
    return rows.map(mapOperatorActionRow)
}

/**
 * Cluster mode (R3 discovery): `GROUP BY(groupBy predicate cols)` + `HAVING count>=minCount`.
 * The watcher is just this reader + aggregation on the same row shape.
 */
export function clusterDispositions(
    db: Database,
    groupBy: DispositionGroupColumn[],
    minCount: number,
    filter: QueryDispositionsFilter = {}
): DispositionCluster[] {
    const cols = groupBy.filter((c): c is DispositionGroupColumn =>
        (DISPOSITION_PREDICATE_COLUMNS as readonly string[]).includes(c)
    )
    if (cols.length === 0) return []
    const { sql, params } = buildDispositionWhere(filter)
    const selectCols = cols.join(', ')
    const rows = db
        .prepare(
            `SELECT ${selectCols}, action, COUNT(*) AS n, MAX(created_at) AS last_created_at
             FROM inbox_operator_actions ${sql}
             GROUP BY ${selectCols}, action`
        )
        .all(...params) as (Record<string, string | null> & { n: number; last_created_at: number })[]

    // Fold the per-action rows into one cluster per key tuple.
    const byKey = new Map<string, DispositionCluster>()
    for (const row of rows) {
        const keys: Partial<Record<DispositionGroupColumn, string | null>> = {}
        for (const c of cols) keys[c] = row[c] ?? null
        const keyId = cols.map((c) => `${c}=${row[c] ?? '∅'}`).join('|')
        let cluster = byKey.get(keyId)
        if (!cluster) {
            cluster = { keys, count: 0, actions: {}, lastCreatedAt: 0 }
            byKey.set(keyId, cluster)
        }
        const action = String(row.action)
        cluster.actions[action] = (cluster.actions[action] ?? 0) + row.n
        cluster.count += row.n
        cluster.lastCreatedAt = Math.max(cluster.lastCreatedAt, row.last_created_at)
    }
    return Array.from(byKey.values())
        .filter((c) => c.count >= Math.max(1, minCount))
        .sort((a, b) => b.count - a.count)
        .slice(0, Math.max(1, Math.min(filter.limit ?? 50, 200)))
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
            event_id INTEGER NOT NULL REFERENCES overseer_events(id),
            PRIMARY KEY (inbox_item_id, event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_item_source_events_event ON inbox_item_source_events(event_id);

        CREATE TABLE IF NOT EXISTS inbox_operator_actions (
            id INTEGER PRIMARY KEY,
            inbox_item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            status_after TEXT NOT NULL,
            feedback TEXT,
            created_at INTEGER NOT NULL,
            source_kind TEXT,
            source_ref TEXT,
            event_type TEXT,
            category TEXT,
            project TEXT,
            artifact_kind TEXT,
            repo TEXT,
            context_snapshot_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_operator_actions_item ON inbox_operator_actions(inbox_item_id, created_at DESC);
    `)

    // R8 disposition snapshot columns — idempotent ADD COLUMN for DBs created before the
    // keystone. The snapshot columns ARE the standing-order predicate fields and the discovery
    // GROUP BY keys (one shared vocabulary). Blob (context_snapshot_json) holds as-seen render
    // context (title/summary/severity/priority/provenance/artifact_refs/source event ids).
    //
    // Phase 3 forward flag (NOT now): when standing-order auto-handling enacts operator policy, those
    // enactments SHOULD write dispositions WITH the snapshot (they are pre-authorized decisions) — but
    // discovery must then mine operator-authored rows only, or it re-suggests orders it already
    // enacts. That is when an `actor` column (operator | standing_order:<id> | system) starts to
    // matter. Left out of v1 deliberately; the ADD COLUMN pattern here graduates it cleanly later.
    ensureInboxOperatorActionSnapshotColumns(db)

    // Discovery clusters on the predicate vocabulary (P2 GROUP BY); index the primary axes.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_inbox_operator_actions_bucket
            ON inbox_operator_actions(source_kind, event_type, category, project);
    `)
}

const INBOX_OPERATOR_ACTION_SNAPSHOT_COLUMNS = [
    'source_kind',
    'source_ref',
    'event_type',
    'category',
    'project',
    'artifact_kind',
    'repo',
    'context_snapshot_json'
] as const

/** Idempotent `ADD COLUMN` for the R8 snapshot columns (SQLite has no `ADD COLUMN IF NOT EXISTS`). */
function ensureInboxOperatorActionSnapshotColumns(db: Database): void {
    const existing = new Set(
        (db.prepare('PRAGMA table_info(inbox_operator_actions)').all() as { name: string }[]).map(
            (c) => c.name
        )
    )
    for (const col of INBOX_OPERATOR_ACTION_SNAPSHOT_COLUMNS) {
        if (!existing.has(col)) {
            db.exec(`ALTER TABLE inbox_operator_actions ADD COLUMN ${col} TEXT`)
        }
    }
}

export function dropOverseerInboxSchema(db: Database): void {
    db.exec(`
        DROP INDEX IF EXISTS idx_inbox_operator_actions_bucket;
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
