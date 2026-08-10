/**
 * One-boss invariant (ADR-001 §"Invariant test").
 *
 * Workers never know about the Overseer: every dispatched instruction arrives
 * operator-attributed. This module is the mechanical check that protects the
 * decision from drift.
 *
 * At Step 2.75 there is no dispatch writer, so a replayed snapshot contains no
 * `dispatched` events and the invariant passes VACUOUSLY (checked === 0). The
 * assertion shape is wired so that when Step 4 lands the dispatch envelope +
 * worker-message writer, replaying a Step-4-era snapshot (which carries
 * `dispatched` events plus their envelopes/messages) activates real coverage
 * with zero changes here.
 *
 * The check is intent-based, not lexical: it does NOT ban the word "overseer"
 * from worker messages (operators legitimately reference the product by name).
 * It bans GENERATED attribution boilerplate and envelope-metadata exposure.
 */
import type { Database } from 'bun:sqlite'
import type { ReplayContext, SnapshotDispatchEnvelope, SnapshotWorkerMessage } from './replayHarness'

/** Curated forbidden-phrase list (ADR-001). Extend per persona archetypes. */
export const FORBIDDEN_ATTRIBUTION_PATTERNS: RegExp[] = [
    /the\s+overseer\s+(says|suggests|asks|wants)/i,
    /your\s+assistant\s+(says|suggests|asks|wants)/i,
    /on\s+behalf\s+of\s+(the\s+)?overseer/i,
    /(message|dispatch|request)\s+from\s+(the\s+)?overseer/i,
    /(chief\s+of\s+staff|fleet\s+manager|fleet\s+coordinator)\s+(says|suggests|wants)/i
]

/** Exact metadata keys that would leak Overseer provenance to a worker. */
export const FORBIDDEN_METADATA_KEYS = [
    'source',
    'origin',
    'dispatched_by',
    'envelope_id',
    'dispatch_envelope_id',
    'rationale',
    'related_event_ids',
    'confirmation_source',
    'idempotency_key'
] as const

export type OneBossViolation = {
    eventId: number
    messageId: string | null
    kind: 'role' | 'metadata-key' | 'attribution-phrase' | 'missing-message'
    detail: string
}

export type OneBossResult = {
    checked: number
    violations: OneBossViolation[]
}

function metadataKeyViolation(
    eventId: number,
    messageId: string,
    metadata: Record<string, unknown>
): OneBossViolation | null {
    for (const key of Object.keys(metadata)) {
        const lower = key.toLowerCase()
        if (lower.startsWith('overseer') || lower.startsWith('overseer_')) {
            return { eventId, messageId, kind: 'metadata-key', detail: `overseer-prefixed metadata key '${key}'` }
        }
        if ((FORBIDDEN_METADATA_KEYS as readonly string[]).includes(lower)) {
            return { eventId, messageId, kind: 'metadata-key', detail: `forbidden metadata key '${key}'` }
        }
    }
    return null
}

function attributionViolation(
    eventId: number,
    messageId: string,
    rendered: string
): OneBossViolation | null {
    for (const pattern of FORBIDDEN_ATTRIBUTION_PATTERNS) {
        if (pattern.test(rendered)) {
            return {
                eventId,
                messageId,
                kind: 'attribution-phrase',
                detail: `rendered instruction matches forbidden attribution ${pattern}`
            }
        }
    }
    return null
}

type DispatchedEventRow = { id: number; idempotency_key: string | null }

/**
 * Check the one-boss invariant over a replayed snapshot.
 *
 * Resolves each `dispatched` event to its dispatch envelope (by
 * idempotency_key) and the worker-facing message it produced, then asserts the
 * message is operator-attributed with no Overseer leakage. Envelopes/messages
 * are read from the snapshot today; Step 4 swaps the resolution to the real
 * `dispatch_envelopes` + `messages` tables.
 */
export function checkOneBossInvariant(ctx: ReplayContext): OneBossResult {
    const db: Database = ctx.db
    const dispatched = db.prepare(
        "SELECT id, idempotency_key FROM overseer_events WHERE event_type = 'dispatched'"
    ).all() as DispatchedEventRow[]

    const envelopeByKey = new Map<string, SnapshotDispatchEnvelope>()
    for (const env of ctx.snapshot.dispatchEnvelopes ?? []) {
        envelopeByKey.set(env.idempotencyKey, env)
    }
    const messageById = new Map<string, SnapshotWorkerMessage>()
    for (const msg of ctx.snapshot.workerMessages ?? []) {
        messageById.set(msg.id, msg)
    }

    const violations: OneBossViolation[] = []

    for (const event of dispatched) {
        const envelope = event.idempotency_key ? envelopeByKey.get(event.idempotency_key) : undefined
        const message = envelope ? messageById.get(envelope.messageId) : undefined

        if (!envelope || !message) {
            // A dispatched event with no resolvable worker message is itself a
            // contract violation once dispatch exists (Step 4); flag it.
            violations.push({
                eventId: event.id,
                messageId: envelope?.messageId ?? null,
                kind: 'missing-message',
                detail: 'dispatched event has no resolvable worker message'
            })
            continue
        }

        if (message.role !== 'user') {
            violations.push({
                eventId: event.id,
                messageId: message.id,
                kind: 'role',
                detail: `worker message role is '${message.role}', expected 'user'`
            })
        }

        const metaViolation = metadataKeyViolation(event.id, message.id, message.metadata ?? {})
        if (metaViolation) violations.push(metaViolation)

        const attrViolation = attributionViolation(event.id, message.id, message.renderedInstruction)
        if (attrViolation) violations.push(attrViolation)
    }

    return { checked: dispatched.length, violations }
}

/** Throwing wrapper for use directly in assertions / CI gate scripts. */
export function assertOneBossInvariant(ctx: ReplayContext): OneBossResult {
    const result = checkOneBossInvariant(ctx)
    if (result.violations.length > 0) {
        const summary = result.violations
            .map((v) => `event #${v.eventId} [${v.kind}]: ${v.detail}`)
            .join('; ')
        throw new Error(`[one-boss] invariant violated (${result.violations.length}): ${summary}`)
    }
    return result
}
