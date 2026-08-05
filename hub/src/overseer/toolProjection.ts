import type { OverseerToolName } from '@hapi/protocol'

/**
 * Project a raw tool result into the lean view the brain actually needs.
 *
 * The read-only tools return rich rows for the debug/HTTP surface, but the brain
 * only needs enough to reason and to ask a follow-up by id. Measured on 174 live
 * inbox items: the FULL result is ~75k tokens (overflows the 64k window); the
 * projected view below is ~3.7k. Everything dropped here (source events, reasons,
 * artifact refs, timestamps) is one `explain_priority` call away.
 *
 * Projection is applied ONLY on the converse path (brain-facing). The HTTP tool
 * endpoint and debug panels still get the full rows.
 */

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

/**
 * Inbox item → the minimum for triage:
 *  - `id`       — to reference it (explain_priority, follow-ups)
 *  - `what`     — the title (the "what")
 *  - `status`   — new / surfaced / held (has the operator seen it?)
 *  - `priority` — explicit rank (also implied by order, but explicit lets the
 *                 brain speak with confidence)
 * Items stay in their incoming priority order.
 */
function projectInboxItem(item: unknown): Record<string, unknown> {
    const o = isObj(item) ? item : {}
    return { id: o.id, what: o.title, status: o.status, priority: o.priority }
}

function len(value: unknown): number | undefined {
    return Array.isArray(value) ? value.length : undefined
}

/**
 * Event → the minimum for reasoning. Drops the fat (payloadJson, idempotencyKey,
 * artifactRefs, provenance, dedupe/sink plumbing) that dominates the row.
 */
function projectEvent(event: unknown): Record<string, unknown> {
    const o = isObj(event) ? event : {}
    return {
        id: o.id,
        ts: o.ts,
        type: o.eventType,
        source: o.sourceKind,
        session: o.relatedSessionId ?? o.sourceRef,
        attention: o.attentionCandidate,
        what: o.summary
    }
}

/** Worker → id/name/project/state/age; drops flavor + raw timestamps. */
function projectWorker(worker: unknown): Record<string, unknown> {
    const o = isObj(worker) ? worker : {}
    return {
        id: o.sessionId,
        name: o.name,
        project: o.project,
        state: o.observedState,
        ageMs: o.ageMs
    }
}

export function projectToolResultForBrain(tool: OverseerToolName, result: unknown): unknown {
    if (tool === 'query_events' && isObj(result) && Array.isArray(result.events)) {
        return { total: result.events.length, events: result.events.map(projectEvent) }
    }
    if (tool === 'list_active_workers' && isObj(result) && Array.isArray(result.workers)) {
        return { total: result.workers.length, workers: result.workers.map(projectWorker) }
    }
    if (tool === 'query_inbox' && isObj(result) && Array.isArray(result.items)) {
        // The raw result is {items, candidates, surfaced, held} — four arrays that
        // repeat the same rows (a big part of the ~75k-token bloat). We keep only
        // the union `items` (thinned) plus cheap segment counts. `total` comes from
        // items.length because the raw result has no total field (was null before).
        return {
            total: result.items.length,
            counts: {
                candidates: len(result.candidates),
                surfaced: len(result.surfaced),
                held: len(result.held)
            },
            items: result.items.map(projectInboxItem)
        }
    }
    return result
}
