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

export function projectToolResultForBrain(tool: OverseerToolName, result: unknown): unknown {
    if (tool === 'query_inbox' && isObj(result) && Array.isArray(result.items)) {
        return {
            total: result.total,
            items: result.items.map(projectInboxItem)
        }
    }
    return result
}
