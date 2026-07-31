/**
 * Overseer entity — read-only hub service (Step 3 / Stage 0).
 *
 * Implements the seven read-only tools the Overseer uses to reason about the
 * fleet, plus `convo_turn` writeback. Everything here is read-only against the
 * substrate (events + inbox + sessions + messages); no dispatch, no mutation of
 * worker state. The single mutation it performs is appending its own
 * memory-bearing `convo_turn` events (contracts §1 three-layer model).
 */

import {
    OVERSEER_LOOP_CLOSED_EVENT_TYPE,
    OVERSEER_STALE_SILENCE_MS,
    buildOverseerConvoTurnEventInput,
    buildOverseerIdentity,
    buildOverseerSystemPrompt,
    deriveObservedWorkerState,
    inferWorkerState,
    isNoOpAction,
    mapEventTypeToWorkerState,
    openLoopBucket,
    type OverseerActiveWorker,
    type OverseerConvoTurnInput,
    type OverseerExplainPriority,
    type OverseerIdentity,
    type OverseerOpenLoop,
    type OverseerOpenLoopsResult,
    type OverseerRecentOutputChunk,
    type OverseerSessionStateView,
    type OverseerWorkerHealth,
    type OverseerWorkerState,
    type QueryEventsArgs,
    type QueryInboxArgs,
    type QueryOpenLoopsArgs,
    type ListActiveWorkersArgs
} from '@hapi/protocol'
import { buildOverseerSessionIdentity } from '@hapi/protocol'
import { extractAssistantPlainText, unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { Session } from '@hapi/protocol/types'
import type { EventStore, StoredSystemEvent } from '../store'
import type { InboxStore, StoredInboxItem } from '../store/inboxStore'
import type { MessageStore } from '../store/messageStore'

export type OverseerEntityDeps = {
    events: EventStore
    inbox: InboxStore
    messages: MessageStore
    getSession: (sessionId: string) => Session | undefined
    getSessions: () => Session[]
    now?: () => number
    staleSilenceMs?: number
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deriveIdentity(session: Session): { name: string | null; project: string | null; flavor: string | null } {
    const identity = buildOverseerSessionIdentity({
        id: session.id,
        flavor: session.metadata?.flavor ?? 'unknown',
        tag: null,
        metadata: session.metadata ?? undefined
    })
    return {
        name: identity.name,
        project: identity.project,
        flavor: session.metadata?.flavor ?? null
    }
}

function pendingRequestCount(session: Session): number {
    const requests = session.agentState?.requests
    return requests ? Object.keys(requests).length : 0
}

export class OverseerEntity {
    private readonly events: EventStore
    private readonly inbox: InboxStore
    private readonly messages: MessageStore
    private readonly getSession: (sessionId: string) => Session | undefined
    private readonly getSessions: () => Session[]
    private readonly now: () => number
    private readonly staleSilenceMs: number

    constructor(deps: OverseerEntityDeps) {
        this.events = deps.events
        this.inbox = deps.inbox
        this.messages = deps.messages
        this.getSession = deps.getSession
        this.getSessions = deps.getSessions
        this.now = deps.now ?? (() => Date.now())
        this.staleSilenceMs = deps.staleSilenceMs ?? OVERSEER_STALE_SILENCE_MS
    }

    identity(): OverseerIdentity {
        return buildOverseerIdentity()
    }

    systemPrompt(): string {
        return buildOverseerSystemPrompt()
    }

    // --- Tool 1: query_events ------------------------------------------------

    queryEvents(args: QueryEventsArgs): StoredSystemEvent[] {
        return this.events.query({
            sessionId: args.sessionId ?? null,
            project: args.project ?? null,
            eventType: args.eventType ?? null,
            sourceKind: args.sourceKind ?? null,
            attentionCandidate: args.attentionCandidate ?? null,
            severityMin: args.severityMin ?? null,
            sinceTs: args.sinceTs ?? null,
            untilTs: args.untilTs ?? null,
            beforeId: args.beforeId ?? null,
            limit: args.limit ?? 50
        })
    }

    // --- Tool 2: query_inbox -------------------------------------------------

    /**
     * Returns inbox items grouped into candidates (`new`), surfaced, and held.
     * Defaults to the operator-relevant set (active + held) when no statuses
     * are supplied.
     */
    queryInbox(args: QueryInboxArgs): {
        items: StoredInboxItem[]
        candidates: StoredInboxItem[]
        surfaced: StoredInboxItem[]
        held: StoredInboxItem[]
    } {
        const statuses = args.statuses && args.statuses.length > 0
            ? args.statuses
            : ['new', 'surfaced', 'deferred', 'snoozed', 'held']
        const items = this.inbox.list({
            statuses,
            sessionId: args.sessionId ?? null,
            category: args.category ?? null,
            limit: args.limit ?? 50
        })
        return {
            items,
            candidates: items.filter((item) => item.status === 'new'),
            surfaced: items.filter((item) => item.status === 'surfaced'),
            held: items.filter((item) => item.status === 'held')
        }
    }

    // --- Tool 3: get_session_state ------------------------------------------

    getSessionState(sessionId: string): OverseerSessionStateView | null {
        const session = this.getSession(sessionId)
        if (!session) return null

        const now = this.now()
        const { name, project, flavor } = deriveIdentity(session)
        const latestEvent = this.events.query({ sessionId, limit: 1 })[0] ?? null
        const lastActivityAt = this.computeLastActivityAt(session, latestEvent)
        const silenceMs = lastActivityAt !== null ? Math.max(0, now - lastActivityAt) : null
        const pending = pendingRequestCount(session)

        const observedState = deriveObservedWorkerState({
            active: session.active,
            thinking: session.thinking,
            silenceMs,
            pendingRequestCount: pending,
            staleSilenceMs: this.staleSilenceMs
        })

        const lastToolCall = this.events.query({ sessionId, eventType: 'tool_call', limit: 1 })[0]
            ?? this.events.query({ sessionId, eventType: 'tool_result', limit: 1 })[0]
            ?? null

        return {
            sessionId,
            name,
            project,
            flavor,
            active: session.active,
            thinking: session.thinking,
            observedState,
            workerReportedState: this.deriveReportedState(sessionId),
            lastActivityAt,
            silenceMs,
            lastToolCallAgeMs: lastToolCall ? Math.max(0, now - lastToolCall.ts) : null,
            pendingRequestCount: pending
        }
    }

    // --- Tool 4: get_session_recent_output ----------------------------------

    getSessionRecentOutput(sessionId: string, n = 10): OverseerRecentOutputChunk[] {
        const limit = Math.min(Math.max(n, 1), 50)
        const messages = this.messages.getMessages(sessionId, limit)
        const chunks: OverseerRecentOutputChunk[] = []
        for (const message of messages) {
            const text = this.extractMessageText(message.content)
            if (!text) continue
            chunks.push({
                messageId: message.id,
                role: this.classifyRole(message.content),
                text,
                createdAt: message.createdAt
            })
        }
        return chunks
    }

    // --- Tool 5: get_worker_health ------------------------------------------

    getWorkerHealth(sessionId: string): OverseerWorkerHealth | null {
        const session = this.getSession(sessionId)
        if (!session) return null

        const now = this.now()
        const { name, project, flavor } = deriveIdentity(session)
        const latestEvent = this.events.query({ sessionId, limit: 1 })[0] ?? null
        const lastActivityAt = this.computeLastActivityAt(session, latestEvent)
        const silenceMs = lastActivityAt !== null ? Math.max(0, now - lastActivityAt) : null
        const pending = pendingRequestCount(session)

        const observedState = deriveObservedWorkerState({
            active: session.active,
            thinking: session.thinking,
            silenceMs,
            pendingRequestCount: pending,
            staleSilenceMs: this.staleSilenceMs
        })
        const reportedState = this.deriveReportedState(sessionId)
        const inferred = inferWorkerState({
            reported: reportedState,
            observed: observedState,
            silenceMs,
            staleSilenceMs: this.staleSilenceMs
        })

        const signals: string[] = []
        signals.push(`hub-observed: ${observedState}`)
        signals.push(reportedState ? `worker-reported: ${reportedState}` : 'worker-reported: (none)')
        if (silenceMs !== null) {
            signals.push(`silent for ${Math.round(silenceMs / 60_000)} min`)
        }
        if (pending > 0) {
            signals.push(`${pending} pending permission request(s)`)
        }
        if (latestEvent) {
            signals.push(`last event #${latestEvent.id} (${latestEvent.eventType}): ${latestEvent.summary}`)
        }
        signals.push(inferred.note)

        return {
            sessionId,
            name,
            project,
            flavor,
            reportedState: reportedState ?? 'unknown',
            observedState,
            inferredState: inferred.state,
            inferredConfidence: inferred.confidence,
            signals,
            lastActivityAt,
            silenceMs,
            pendingRequestCount: pending
        }
    }

    // --- Tool 6: explain_priority -------------------------------------------

    explainPriority(itemId: number): OverseerExplainPriority | null {
        const item = this.inbox.getById(itemId)
        if (!item) return null

        const sourceEvents = item.sourceEventIds
            .map((id) => this.events.getById(id))
            .filter((event): event is StoredSystemEvent => event !== null)
            .map((event) => ({
                id: event.id,
                eventType: event.eventType,
                summary: event.summary,
                ts: event.ts,
                severity: event.severity,
                sourceKind: event.sourceKind
            }))

        return {
            inboxItemId: item.id,
            title: item.title,
            category: item.category,
            status: item.status,
            priority: item.priority,
            basePriority: item.basePriority,
            agingFactor: item.agingFactor,
            timeCriticality: item.timeCriticality,
            // Recite the stored provenance — do NOT recompute (substrate authored it).
            reasonForPriority: item.reasonForPriority,
            sourceEventIds: item.sourceEventIds,
            relatedSessionId: item.relatedSessionId,
            sourceEvents
        }
    }

    // --- Tool 7: list_active_workers ----------------------------------------

    listActiveWorkers(args: ListActiveWorkersArgs = {}): OverseerActiveWorker[] {
        const now = this.now()
        const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
        const roster: OverseerActiveWorker[] = []

        for (const session of this.getSessions()) {
            const { name, project, flavor } = deriveIdentity(session)
            const latestEvent = this.events.query({ sessionId: session.id, limit: 1 })[0] ?? null
            const lastActivityAt = this.computeLastActivityAt(session, latestEvent)
            const silenceMs = lastActivityAt !== null ? Math.max(0, now - lastActivityAt) : null
            const observedState = deriveObservedWorkerState({
                active: session.active,
                thinking: session.thinking,
                silenceMs,
                pendingRequestCount: pendingRequestCount(session),
                staleSilenceMs: this.staleSilenceMs
            })
            const ageMs = lastActivityAt !== null ? Math.max(0, now - lastActivityAt) : null

            if (args.project && project !== args.project) continue
            if (args.state && observedState !== args.state) continue
            if (args.minAgeMs !== undefined && (ageMs === null || ageMs < args.minAgeMs)) continue

            roster.push({
                sessionId: session.id,
                name,
                project,
                flavor,
                observedState,
                active: session.active,
                lastActivityAt,
                ageMs
            })
        }

        roster.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
        return roster.slice(0, limit)
    }

    // --- Tool 8: query_open_loops -------------------------------------------

    /**
     * The "what am I forgetting?" lens (neglect axis, not urgency). For each
     * session takes its latest status-bearing worker event; a loop is OPEN when
     * that latest event is not `completed`. No-op `action` placeholders are
     * nulled (status≠done is the strong filter; action is only a tiebreak).
     * Presents "Waiting on You" (operator owes a decision) before half-finished
     * work, each coldest-first.
     *
     * Spans ALL non-deleted sessions (active AND archived) — it reads only the
     * events table and never filters on `session.active`. Deleted sessions drop
     * out automatically because `deleteSession` detaches their events
     * (`related_session_id = NULL`) and the substrate query requires it non-null.
     */
    queryOpenLoops(args: QueryOpenLoopsArgs = {}): OverseerOpenLoopsResult {
        const now = this.now()
        const minAgeMs = args.minAgeMs ?? 0
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 100)

        const loops: OverseerOpenLoop[] = []
        for (const event of this.events.latestWorkerStatusPerSession()) {
            if (event.eventType === OVERSEER_LOOP_CLOSED_EVENT_TYPE) continue // loop closed by a later done turn

            const payload = this.parseEventPayload(event.payloadJson)
            const notify = payload && isObjectRecord(payload.notify_summary)
                ? payload.notify_summary as { status?: unknown; action?: unknown }
                : null
            const status = typeof notify?.status === 'string' && notify.status.length > 0
                ? notify.status
                : event.eventType
            const rawAction = typeof notify?.action === 'string'
                ? notify.action
                : typeof payload?.suggested_action === 'string'
                    ? payload.suggested_action
                    : null
            const action = rawAction && !isNoOpAction(rawAction) ? rawAction.trim() : null

            const identity = this.openLoopIdentity(event)
            if (args.project && identity.project !== args.project) continue

            const ageMs = Math.max(0, now - event.ts)
            if (ageMs < minAgeMs) continue

            const bucket = openLoopBucket(event.eventType)
            if (args.bucket && bucket !== args.bucket) continue

            loops.push({
                sessionId: event.relatedSessionId ?? '',
                name: identity.name,
                project: identity.project,
                flavor: identity.flavor,
                status,
                eventType: event.eventType,
                eventId: event.id,
                action,
                summary: event.summary,
                lastTs: event.ts,
                ageMs,
                ageDays: Math.round((ageMs / 86_400_000) * 10) / 10,
                bucket
            })
        }

        // Waiting-on-You first, then half-finished; each coldest (oldest) first.
        const bucketRank = (b: OverseerOpenLoop['bucket']): number => (b === 'waiting_on_you' ? 0 : 1)
        loops.sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket) || b.ageMs - a.ageMs)

        const waitingOnYou = loops.filter((l) => l.bucket === 'waiting_on_you').length
        return {
            openLoops: loops.slice(0, limit),
            counts: {
                total: loops.length,
                waitingOnYou,
                halfFinished: loops.length - waitingOnYou
            }
        }
    }

    // --- convo_turn writeback -----------------------------------------------

    recordConvoTurn(input: OverseerConvoTurnInput): StoredSystemEvent | null {
        const eventInput = buildOverseerConvoTurnEventInput({ ...input, ts: input.ts ?? this.now() })
        return this.events.insert(eventInput)
    }

    // --- internals -----------------------------------------------------------

    private parseEventPayload(payloadJson: string | null): {
        notify_summary?: unknown
        suggested_action?: unknown
        session?: { id?: string; name?: string | null; project?: string | null; flavor?: string | null }
    } | null {
        if (!payloadJson) return null
        try {
            const parsed: unknown = JSON.parse(payloadJson)
            return isObjectRecord(parsed) ? parsed : null
        } catch {
            return null
        }
    }

    /** Identity for an open loop — prefer the event's denormalized session (survives session deletion). */
    private openLoopIdentity(event: StoredSystemEvent): { name: string | null; project: string | null; flavor: string | null } {
        const payload = this.parseEventPayload(event.payloadJson)
        const denorm = payload?.session
        if (denorm && (denorm.name || denorm.project || denorm.flavor)) {
            return {
                name: denorm.name ?? null,
                project: denorm.project ?? null,
                flavor: denorm.flavor ?? null
            }
        }
        const session = event.relatedSessionId ? this.getSession(event.relatedSessionId) : undefined
        if (session) return deriveIdentity(session)
        return { name: null, project: null, flavor: null }
    }

    private computeLastActivityAt(session: Session, latestEvent: StoredSystemEvent | null): number | null {
        const candidates = [session.activeAt, session.updatedAt, latestEvent?.ts]
            .filter((value): value is number => typeof value === 'number' && value > 0)
        return candidates.length > 0 ? Math.max(...candidates) : null
    }

    private deriveReportedState(sessionId: string): OverseerWorkerState | null {
        const workerEvent = this.events.query({ sessionId, sourceKind: 'worker', limit: 1 })[0] ?? null
        if (!workerEvent) return null
        return mapEventTypeToWorkerState(workerEvent.eventType)
    }

    private extractMessageText(content: unknown): string | null {
        const record = unwrapRoleWrappedRecordEnvelope(content)
        if (record?.role === 'agent') {
            return extractAssistantPlainText(record.content)
        }
        const direct = extractAssistantPlainText(content)
        if (direct) return direct
        // Operator/user messages: best-effort plain text.
        if (record?.role === 'user' && typeof record.content === 'string') {
            return record.content
        }
        return null
    }

    private classifyRole(content: unknown): 'operator' | 'worker' | 'unknown' {
        const record = unwrapRoleWrappedRecordEnvelope(content)
        if (record?.role === 'agent') return 'worker'
        if (record?.role === 'user') return 'operator'
        return 'unknown'
    }
}
