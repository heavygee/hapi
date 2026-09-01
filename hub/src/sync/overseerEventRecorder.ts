import {
    buildEventSummaryFromNotify,
    buildLinkSeenSummary,
    buildOverseerSessionIdentity,
    buildUrlArtifactRefs,
    deriveAttentionCandidate,
    deriveOperatorActionRequired,
    deriveSeverity,
    detectEmptyHapiEventsSentinel,
    detectMalformedNotifySummaryLine,
    extractHttpUrls,
    mapNotifyStatusToEventType,
    mergeEventPayloadWithSession,
    normalizeUrlIdempotencyKey,
    usableNotifyAction,
    usableNotifyToken,
    isObject,
    type NotifySummary,
    type OverseerSessionIdentity
} from '@hapi/protocol'
import {
    extractAssistantPlainText,
    extractNotifySummary,
    unwrapRoleWrappedRecordEnvelope
} from '@hapi/protocol/messages'
import type { Session } from '@hapi/protocol/types'
import type { EventStore, InsertSystemEventInput, StoredSystemEvent } from '../store'
import type { InboxStore } from '../store/inboxStore'
import type { OverseerLlmFallbackClient } from './overseerLlmFallback'

export type SessionSnapshot = OverseerSessionIdentity

export type OverseerEventRecorderOptions = {
    /** Opt-in OpenAI-compatible synthesizer (issue #90). Default: unset / off. */
    llmFallback?: OverseerLlmFallbackClient | null
    /** Fired after an async Session Log insert so SSE clients can refetch. */
    onAsyncSystemEvent?: ((sessionId: string) => void) | null
}

export type OnAgentMessageOptions = {
    /**
     * When true, defer opt-in LLM fallback until thinking clears so ACP
     * mid-turn text flushes do not each trigger a synthesis call.
     */
    thinking?: boolean
}

type PendingLlmFallback = {
    messageId: string
    plainText: string
    ts: number
    epoch: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return isObject(value) ? value as Record<string, unknown> : null
}

function extractTextBlocks(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
    }
    if (Array.isArray(value)) {
        const parts: string[] = []
        for (const block of value) {
            const record = asRecord(block)
            if (record?.type === 'text' && typeof record.text === 'string') {
                parts.push(record.text)
            } else if (typeof block === 'string') {
                parts.push(block)
            }
        }
        const joined = parts.join('\n').trim()
        return joined.length > 0 ? joined : null
    }
    const record = asRecord(value)
    if (record?.type === 'text' && typeof record.text === 'string') {
        return record.text
    }
    return null
}

/** Best-effort plain text for URL scoop (agent + user message shapes). */
export function extractTextForLinkScoop(content: unknown): string | null {
    const envelope = unwrapRoleWrappedRecordEnvelope(content)
    const body = envelope?.content ?? content

    const assistant = extractAssistantPlainText(body)
    if (assistant) return assistant

    const direct = extractTextBlocks(body)
    if (direct) return direct

    const record = asRecord(body)
    if (record?.type === 'output') {
        const data = asRecord(record.data)
        const message = asRecord(data?.message)
        if (message) {
            const fromMessage = extractTextBlocks(message.content)
            if (fromMessage) return fromMessage
        }
    }
    if (record?.type === 'codex') {
        const data = asRecord(record.data)
        if (typeof data?.message === 'string' && data.message.length > 0) {
            return data.message
        }
    }

    return null
}

function buildPayload(
    session: SessionSnapshot,
    fields: Record<string, unknown>,
    notifyProject?: string | null
): string {
    const usable = usableNotifyToken(notifyProject)
    const identity = usable
        ? buildOverseerSessionIdentity({
            id: session.id,
            flavor: session.flavor,
            tag: session.tag,
            metadata: { name: session.name ?? undefined },
            notifyProject: usable
        })
        : session
    return mergeEventPayloadWithSession(fields, identity)
}

function isAgentMessageContent(content: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    return record?.role === 'agent'
}

function extractToolFailureSummary(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (record?.role !== 'agent') return null
    const body = record.content
    if (!isObject(body)) return null

    if (body.type === 'codex') {
        const data = asRecord(body.data)
        if (data?.type !== 'tool-call-result') return null
        const output = asRecord(data.output)
        const exitCode = typeof output?.exit_code === 'number'
            ? output.exit_code
            : typeof output?.exitCode === 'number'
                ? output.exitCode
                : null
        if (exitCode === null || exitCode === 0) return null
        const stderr = typeof output?.stderr === 'string' ? output.stderr.trim() : ''
        return stderr.length > 0 ? `Tool failed (exit ${exitCode}): ${stderr.slice(0, 160)}` : `Tool failed with exit code ${exitCode}`
    }

    return null
}

function buildTags(notify: NotifySummary | null, flavor: string): string | null {
    const parts: string[] = []
    const agent = usableNotifyToken(notify?.agent)
    const project = usableNotifyToken(notify?.project)
    if (agent) parts.push(`agent:${agent}`)
    if (project) parts.push(`project:${project}`)
    parts.push(`flavor:${flavor}`)
    return parts.length > 0 ? parts.join(' ') : null
}

export class OverseerEventRecorder {
    private readonly lastAgentMessageAt = new Map<string, number>()
    private readonly knownPermissionRequestIds = new Map<string, Set<string>>()
    private readonly llmFallback: OverseerLlmFallbackClient | null
    private readonly onAsyncSystemEvent: ((sessionId: string) => void) | null
    /** Latest no-notify assistant text awaiting end-of-turn LLM attempt. */
    private readonly pendingLlmFallback = new Map<string, PendingLlmFallback>()
    private readonly sessionThinking = new Map<string, boolean>()
    /** Per-session tail so concurrent LLM calls insert in arrival order. */
    private readonly sessionWork = new Map<string, Promise<unknown>>()
    private readonly turnEpoch = new Map<string, number>()
    /** Epoch of the last successful LLM fallback for this session. */
    private readonly llmFallbackSucceededEpoch = new Map<string, number>()
    private readonly seenUserMessageIds = new Map<string, Set<string>>()
    private readonly sessionEnded = new Set<string>()

    constructor(
        private readonly events: EventStore,
        private readonly inbox?: InboxStore,
        options?: OverseerEventRecorderOptions
    ) {
        this.llmFallback = options?.llmFallback ?? null
        this.onAsyncSystemEvent = options?.onAsyncSystemEvent ?? null
    }

    list(options: Parameters<EventStore['list']>[0] = {}): StoredSystemEvent[] {
        return this.events.list(options)
    }

    count(): number {
        return this.events.count()
    }

    async onAgentMessage(
        session: SessionSnapshot,
        messageId: string,
        content: unknown,
        ts: number,
        opts: OnAgentMessageOptions = {}
    ): Promise<StoredSystemEvent | null> {
        let primary: StoredSystemEvent | null = null

        if (isAgentMessageContent(content)) {
            this.lastAgentMessageAt.set(session.id, ts)

            const agentBody = unwrapRoleWrappedRecordEnvelope(content)
            const agentContent = agentBody?.role === 'agent' ? agentBody.content : content

            // Scoop URLs before any queued await so a slow/crashed fallback
            // cannot drop already-persisted assistant links.
            this.scoopLinksFromContent(session, messageId, content, ts)

            const plainText = extractAssistantPlainText(agentContent)
            if (plainText) {
                if (detectEmptyHapiEventsSentinel(plainText)) {
                    this.pendingLlmFallback.delete(session.id)
                    primary = await this.enqueueSessionWork(session.id, () =>
                        Promise.resolve(this.insertInferredEvent(session, {
                            ts,
                            sourceKind: 'system',
                            eventType: 'validation_error',
                            attentionCandidate: 0,
                            summary: 'Malformed HAPI_EVENTS sentinel block (empty body)',
                            relatedSessionId: session.id,
                            provenance: 'hub-inferred from empty HAPI_EVENTS sentinel pair',
                            idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:empty_hapi_events`,
                            payloadFields: { messageId, plainTextPreview: plainText.slice(0, 500) },
                            severity: 1
                        }))
                    )
                } else if (detectMalformedNotifySummaryLine(plainText)) {
                    this.pendingLlmFallback.delete(session.id)
                    primary = await this.enqueueSessionWork(session.id, () =>
                        Promise.resolve(this.insertInferredEvent(session, {
                            ts,
                            sourceKind: 'system',
                            eventType: 'validation_error',
                            attentionCandidate: 0,
                            summary: 'Malformed AGENT_NOTIFY_SUMMARY line on last turn',
                            relatedSessionId: session.id,
                            provenance: 'hub-inferred from malformed AGENT_NOTIFY_SUMMARY JSON',
                            idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:malformed_notify`,
                            payloadFields: { messageId },
                            severity: 1
                        }))
                    )
                } else {
                    const notify = extractNotifySummary(plainText)
                    if (notify) {
                        this.pendingLlmFallback.delete(session.id)
                        primary = await this.enqueueSessionWork(session.id, () => {
                            const stored = this.recordNotifySummary(session, messageId, notify, ts)
                            if (stored) this.onAsyncSystemEvent?.(session.id)
                            return Promise.resolve(stored)
                        })
                    }
                }
            }

            if (!primary) {
                const toolFailure = extractToolFailureSummary(agentContent)
                if (toolFailure) {
                    primary = await this.enqueueSessionWork(session.id, () =>
                        Promise.resolve(this.insertInferredEvent(session, {
                            ts,
                            sourceKind: 'system',
                            sourceRef: session.id,
                            eventType: 'failed',
                            attentionCandidate: 1,
                            operatorActionRequired: 1,
                            summary: toolFailure,
                            relatedSessionId: session.id,
                            provenance: 'hub-inferred from tool-call-result exit code',
                            idempotencyKey: `session:${session.id}:message:${messageId}:tool_failed`,
                            payloadFields: { messageId },
                            severity: deriveSeverity('failed'),
                            tags: buildTags(null, session.flavor)
                        }))
                    )
                }
            }

            // Opt-in LLM only (#90). No first-line heuristic. Defer while
            // thinking so ACP mid-turn flushes do not each hit the LLM.
            if (!primary && plainText && this.llmFallback) {
                if (opts.thinking) {
                    this.rememberPendingLlmFallback(session.id, messageId, plainText, ts)
                } else {
                    this.pendingLlmFallback.delete(session.id)
                    this.bumpTurnEpoch(session.id)
                    const epoch = this.currentTurnEpoch(session.id)
                    primary = await this.enqueueSessionWork(session.id, () =>
                        this.tryLlmFallback(session, messageId, plainText, ts, epoch)
                    )
                }
            }
            return primary
        }

        // Peer pings land as role=user. Scrape synchronously — do not queue behind
        // in-flight LLM fallback work on the same session.
        const userPlainText = extractTextForLinkScoop(content)
        if (userPlainText) {
            primary = this.recordNotifyFromPlainText(session, messageId, userPlainText, ts, {
                deliveryRole: 'user'
            })
        }

        const seen = this.seenUserMessageIds.get(session.id) ?? new Set<string>()
        if (!seen.has(messageId)) {
            seen.add(messageId)
            this.seenUserMessageIds.set(session.id, seen)
            this.bumpTurnEpoch(session.id)
        }
        this.scoopLinksFromContent(session, messageId, content, ts)
        return primary
    }

    async onSessionUpdated(session: Session, tag?: string | null): Promise<void> {
        const wasThinking = this.sessionThinking.get(session.id) === true
        this.sessionThinking.set(session.id, session.thinking)
        if (session.thinking && !wasThinking) {
            this.bumpTurnEpoch(session.id)
        }
        await this.syncPermissionRequests(session, tag ?? null)
        // Flush whenever thinking is clear and a deferred turn is waiting —
        // not only on a true→false edge. Keepalives often never sent the
        // thinking=true update through this recorder.
        if (!session.thinking) {
            await this.flushPendingLlmFallback(toSessionSnapshot(session, tag ?? null))
        }
    }

    async onSessionEnd(
        session: Session,
        tag: string | null,
        ts: number,
        reason: string | undefined,
        getLastAgentPlainText: () => string | null
    ): Promise<StoredSystemEvent | null> {
        this.sessionEnded.add(session.id)
        this.knownPermissionRequestIds.delete(session.id)
        this.sessionThinking.delete(session.id)
        const snapshot = toSessionSnapshot(session, tag)
        const pending = this.takePendingLlmFallback(session.id)

        return this.enqueueSessionWork(session.id, async () => {
            try {
                const llmEvent = pending
                    ? await this.runPendingLlmFallback(snapshot, pending)
                    : null
                if (reason !== 'completed') {
                    return llmEvent
                }

                const lastText = getLastAgentPlainText()
                if (lastText && extractNotifySummary(lastText)) {
                    return llmEvent
                }
                // Successful LLM row already captured this turn (epoch), including
                // same-turn ACP tool/usage messages after the text flush.
                if (llmEvent || this.llmFallbackSucceededEpoch.get(session.id) === this.currentTurnEpoch(session.id)) {
                    return llmEvent
                }

                const stored = this.insertSystemEvent(snapshot, {
                    ts,
                    sourceKind: 'system',
                    sourceRef: session.id,
                    eventType: 'completed',
                    attentionCandidate: 0,
                    summary: 'Session ended without AGENT_NOTIFY_SUMMARY; hub inferred completion',
                    relatedSessionId: session.id,
                    provenance: 'hub-inferred from session-end completed signal',
                    idempotencyKey: `session:${session.id}:session_end:${ts}:completed_fallback`,
                    payloadFields: { reason },
                    severity: deriveSeverity('completed'),
                    tags: buildTags(null, snapshot.flavor)
                })
                if (stored) this.onAsyncSystemEvent?.(session.id)
                return stored
            } finally {
                this.clearTurnState(session.id)
            }
        })
    }

    async flushPendingLlmFallback(session: SessionSnapshot): Promise<StoredSystemEvent | null> {
        const pending = this.takePendingLlmFallback(session.id)
        if (!pending) return null
        return this.enqueueSessionWork(session.id, () => this.runPendingLlmFallback(session, pending))
    }

    private takePendingLlmFallback(sessionId: string): PendingLlmFallback | undefined {
        const pending = this.pendingLlmFallback.get(sessionId)
        if (pending) this.pendingLlmFallback.delete(sessionId)
        return pending
    }

    private rememberPendingLlmFallback(
        sessionId: string,
        messageId: string,
        plainText: string,
        ts: number
    ): void {
        const prev = this.pendingLlmFallback.get(sessionId)
        // New ACP text segment in the same thinking turn — keep the whole turn.
        // Same messageId is a redelivery; replace rather than duplicate.
        const combined = prev && prev.messageId !== messageId
            ? `${prev.plainText}\n${plainText}`
            : plainText
        this.pendingLlmFallback.set(sessionId, {
            messageId,
            plainText: combined,
            ts,
            epoch: prev?.epoch ?? this.currentTurnEpoch(sessionId)
        })
    }

    private async runPendingLlmFallback(
        session: SessionSnapshot,
        pending: PendingLlmFallback
    ): Promise<StoredSystemEvent | null> {
        if (extractNotifySummary(pending.plainText)) return null
        return this.tryLlmFallback(session, pending.messageId, pending.plainText, pending.ts, pending.epoch)
    }

    private enqueueSessionWork<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
        const previous = this.sessionWork.get(sessionId) ?? Promise.resolve()
        const run = previous.then(work, work)
        const tail: Promise<unknown> = run.then(() => undefined, () => undefined)
        this.sessionWork.set(sessionId, tail)
        void tail.then(() => {
            if (this.sessionWork.get(sessionId) === tail) {
                this.sessionWork.delete(sessionId)
            }
        })
        return run
    }

    /**
     * Opt-in LLM synthesis only. Failures return null — never invent a
     * first-line heuristic Session Log row.
     */
    private async tryLlmFallback(
        session: SessionSnapshot,
        messageId: string,
        plainText: string,
        ts: number,
        epoch: number
    ): Promise<StoredSystemEvent | null> {
        if (!this.llmFallback) return null
        try {
            const notify = await this.llmFallback.synthesizeNotifySummary(plainText)
            if (!notify) return null
            // Session Log All hides `stale` (ambient silence). Keep LLM
            // fallbacks visible as captured-only progress.
            const mapped = mapNotifyStatusToEventType(notify.status)
            const eventType = mapped === 'stale' ? 'progress' : mapped
            const stored = this.insertSystemEvent(session, {
                ts,
                sourceKind: 'system',
                sourceRef: session.id,
                eventType,
                attentionCandidate: 0,
                operatorActionRequired: 0,
                summary: buildEventSummaryFromNotify(notify),
                relatedSessionId: session.id,
                provenance: 'hub-llm-fallback (no AGENT_NOTIFY_SUMMARY from primary agent)',
                idempotencyKey: `session:${session.id}:message:${messageId}:turn_fallback`,
                payloadFields: {
                    messageId,
                    synthesized: true,
                    synthesis: 'llm-fallback',
                    notify_summary: notify,
                    suggested_action: notify.action ?? null,
                },
                notifyProject: notify.project ?? null,
                severity: deriveSeverity(eventType),
                tags: buildTags(notify, session.flavor),
            })
            if (stored) {
                this.llmFallbackSucceededEpoch.set(session.id, epoch)
                this.onAsyncSystemEvent?.(session.id)
            }
            return stored
        } catch {
            return null
        }
    }

    /**
     * Hub silence sweep — deliberately does **not** persist `stale` rows.
     *
     * Idle silence is ambient state derivable from last-activity timestamps
     * (`get_worker_health` / list-active). Writing one durable event per idle
     * session filled Session Logs with "No agent output for 30 minutes" noise
     * and wasted storage. Worker self-reported `stalled` (via AGENT_NOTIFY_SUMMARY)
     * still becomes a normal attention-qualified event through the notify path.
     *
     * Kept as a SyncEngine tick hook for API stability; returns [].
     */
    checkStaleSessions(_activeSessions: Session[], _now: number = Date.now()): StoredSystemEvent[] {
        return []
    }

    seedLastAgentMessageAt(sessionId: string, ts: number): void {
        this.lastAgentMessageAt.set(sessionId, ts)
    }

    /** Drop deferred LLM state when a session is deleted (do not flush). */
    forgetSession(sessionId: string): void {
        this.pendingLlmFallback.delete(sessionId)
        this.sessionWork.delete(sessionId)
        this.clearTurnState(sessionId)
        this.lastAgentMessageAt.delete(sessionId)
        this.knownPermissionRequestIds.delete(sessionId)
        this.sessionThinking.delete(sessionId)
        this.sessionEnded.delete(sessionId)
    }

    private clearTurnState(sessionId: string): void {
        this.turnEpoch.delete(sessionId)
        this.llmFallbackSucceededEpoch.delete(sessionId)
        this.seenUserMessageIds.delete(sessionId)
    }

    private currentTurnEpoch(sessionId: string): number {
        return this.turnEpoch.get(sessionId) ?? 0
    }

    private bumpTurnEpoch(sessionId: string): void {
        this.turnEpoch.set(sessionId, this.currentTurnEpoch(sessionId) + 1)
    }

    private scoopLinksFromContent(
        session: SessionSnapshot,
        messageId: string,
        content: unknown,
        ts: number
    ): StoredSystemEvent[] {
        const text = extractTextForLinkScoop(content)
        if (!text) return []

        const urls = extractHttpUrls(text)
        if (urls.length === 0) return []

        const emitted: StoredSystemEvent[] = []
        for (const url of urls) {
            const urlKey = normalizeUrlIdempotencyKey(url)
            const event = this.insertSystemEvent(session, {
                ts,
                sourceKind: 'system',
                sourceRef: session.id,
                eventType: 'link_seen',
                attentionCandidate: 0,
                operatorActionRequired: 0,
                summary: buildLinkSeenSummary(url),
                relatedSessionId: session.id,
                provenance: 'hub-inferred from message URL scoop',
                idempotencyKey: `session:${session.id}:message:${messageId}:link:${urlKey}`,
                payloadFields: { messageId, url },
                artifactRefs: JSON.stringify(buildUrlArtifactRefs([url], 'inferred', ts)),
                severity: deriveSeverity('link_seen'),
                tags: buildTags(null, session.flavor)
            })
            if (event) emitted.push(event)
        }
        return emitted
    }

    private recordNotifyFromPlainText(
        session: SessionSnapshot,
        messageId: string,
        plainText: string,
        ts: number,
        extras: { deliveryRole?: 'agent' | 'user' } = {}
    ): StoredSystemEvent | null {
        if (detectEmptyHapiEventsSentinel(plainText)) {
            return this.insertSystemEvent(session, {
                ts,
                sourceKind: 'system',
                eventType: 'validation_error',
                attentionCandidate: 0,
                summary: 'Malformed HAPI_EVENTS sentinel block (empty body)',
                relatedSessionId: session.id,
                provenance: 'hub-inferred from empty HAPI_EVENTS sentinel pair',
                idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:empty_hapi_events`,
                payloadFields: { messageId, plainTextPreview: plainText.slice(0, 500), ...extras },
                severity: 1
            })
        }
        if (detectMalformedNotifySummaryLine(plainText)) {
            return this.insertSystemEvent(session, {
                ts,
                sourceKind: 'system',
                eventType: 'validation_error',
                attentionCandidate: 0,
                summary: 'Malformed AGENT_NOTIFY_SUMMARY line on last turn',
                relatedSessionId: session.id,
                provenance: 'hub-inferred from malformed AGENT_NOTIFY_SUMMARY JSON',
                idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:malformed_notify`,
                payloadFields: { messageId, ...extras },
                severity: 1
            })
        }
        const notify = extractNotifySummary(plainText)
        if (!notify) {
            return null
        }
        return this.recordNotifySummary(session, messageId, notify, ts, extras)
    }

    private recordNotifySummary(
        session: SessionSnapshot,
        messageId: string,
        notify: NotifySummary,
        ts: number,
        extras: { deliveryRole?: 'agent' | 'user' } = {}
    ): StoredSystemEvent | null {
        const eventType = mapNotifyStatusToEventType(notify.status)
        const attentionCandidate = deriveAttentionCandidate(notify.status, notify.action)
        const operatorActionRequired = deriveOperatorActionRequired(notify.status, notify.action)
        const sourceRef = usableNotifyToken(notify.agent)
            ?? usableNotifyToken(notify.project)
            ?? session.tag
            ?? session.id

        return this.insertSystemEvent(session, {
            ts,
            sourceKind: 'worker',
            sourceRef,
            eventType,
            attentionCandidate,
            operatorActionRequired,
            summary: buildEventSummaryFromNotify(notify),
            relatedSessionId: session.id,
            provenance: extras.deliveryRole === 'user'
                ? 'AGENT_NOTIFY_SUMMARY (user-role delivery)'
                : 'AGENT_NOTIFY_SUMMARY',
            idempotencyKey: `session:${session.id}:message:${messageId}:notify`,
            payloadFields: {
                messageId,
                notify_summary: notify,
                suggested_action: usableNotifyAction(notify.action),
                ...extras
            },
            notifyProject: usableNotifyToken(notify.project),
            severity: deriveSeverity(eventType),
            tags: buildTags(notify, session.flavor)
        })
    }

    private async syncPermissionRequests(session: Session, tag: string | null): Promise<void> {
        if (this.sessionEnded.has(session.id)) return
        const requests = session.agentState?.requests ?? null
        if (!requests) {
            this.knownPermissionRequestIds.delete(session.id)
            return
        }

        const snapshot = toSessionSnapshot(session, tag)
        const currentIds = new Set(Object.keys(requests))
        const known = this.knownPermissionRequestIds.get(session.id) ?? new Set<string>()

        for (const requestId of currentIds) {
            if (known.has(requestId)) continue
            known.add(requestId)
            this.knownPermissionRequestIds.set(session.id, new Set(known))
            const request = asRecord(requests[requestId])
            const toolName = typeof request?.tool === 'string' ? request.tool : 'tool'
            const summary = `Permission requested: ${toolName}`
            const ts = Date.now()
            await this.enqueueSessionWork(session.id, () =>
                Promise.resolve(this.insertInferredEvent(snapshot, {
                    ts,
                    sourceKind: 'system',
                    sourceRef: session.id,
                    eventType: 'approval_requested',
                    attentionCandidate: 1,
                    operatorActionRequired: 1,
                    summary,
                    relatedSessionId: session.id,
                    provenance: 'hub-inferred from permission prompt',
                    idempotencyKey: `session:${session.id}:permission:${requestId}`,
                    payloadFields: { requestId, request },
                    severity: deriveSeverity('approval_requested'),
                    tags: buildTags(null, snapshot.flavor)
                }))
            )
        }

        if (!this.sessionEnded.has(session.id)) {
            this.knownPermissionRequestIds.set(session.id, currentIds)
        }
    }

    private insertInferredEvent(
        session: SessionSnapshot,
        input: Omit<InsertSystemEventInput, 'riskDetected' | 'payloadJson'> & {
            riskDetected?: 0 | 1
            payloadFields?: Record<string, unknown>
            notifyProject?: string | null
        }
    ): StoredSystemEvent | null {
        const stored = this.insertSystemEvent(session, input)
        if (stored) this.onAsyncSystemEvent?.(session.id)
        return stored
    }

    private insertSystemEvent(
        session: SessionSnapshot,
        input: Omit<InsertSystemEventInput, 'riskDetected' | 'payloadJson'> & {
            riskDetected?: 0 | 1
            payloadFields?: Record<string, unknown>
            notifyProject?: string | null
        }
    ): StoredSystemEvent | null {
        const { payloadFields = {}, notifyProject, ...rest } = input
        const stored = this.events.insert({
            riskDetected: 0,
            ...rest,
            payloadJson: buildPayload(session, payloadFields, notifyProject)
        })
        if (stored && stored.attentionCandidate === 1 && this.inbox) {
            this.inbox.promoteAttentionEvent(stored)
        }
        return stored
    }
}

export function toSessionSnapshot(session: Session, tag?: string | null): SessionSnapshot {
    return buildOverseerSessionIdentity({
        id: session.id,
        flavor: session.metadata?.flavor ?? 'claude',
        tag: tag ?? null,
        metadata: session.metadata
    })
}

export function shouldInjectNotifyContract(flavor: string | undefined | null): boolean {
    return flavor !== 'cursor'
}
