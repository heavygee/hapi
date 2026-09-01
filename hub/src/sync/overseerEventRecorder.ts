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

export type SessionSnapshot = OverseerSessionIdentity

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
    const identity = notifyProject
        ? buildOverseerSessionIdentity({
            id: session.id,
            flavor: session.flavor,
            tag: session.tag,
            metadata: { name: session.name ?? undefined },
            notifyProject
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
    if (notify?.agent) parts.push(`agent:${notify.agent}`)
    if (notify?.project) parts.push(`project:${notify.project}`)
    parts.push(`flavor:${flavor}`)
    return parts.length > 0 ? parts.join(' ') : null
}

export class OverseerEventRecorder {
    private readonly lastAgentMessageAt = new Map<string, number>()
    private readonly knownPermissionRequestIds = new Map<string, Set<string>>()

    constructor(
        private readonly events: EventStore,
        private readonly inbox?: InboxStore
    ) {}

    list(options: Parameters<EventStore['list']>[0] = {}): StoredSystemEvent[] {
        return this.events.list(options)
    }

    count(): number {
        return this.events.count()
    }

    onAgentMessage(session: SessionSnapshot, messageId: string, content: unknown, ts: number): StoredSystemEvent | null {
        let primary: StoredSystemEvent | null = null

        if (isAgentMessageContent(content)) {
            this.lastAgentMessageAt.set(session.id, ts)

            const agentBody = unwrapRoleWrappedRecordEnvelope(content)
            const agentContent = agentBody?.role === 'agent' ? agentBody.content : content

            const plainText = extractAssistantPlainText(agentContent)
            if (plainText) {
                primary = this.recordNotifyFromPlainText(session, messageId, plainText, ts)
            }

            if (!primary) {
                const toolFailure = extractToolFailureSummary(agentContent)
                if (toolFailure) {
                    primary = this.insertSystemEvent(session, {
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
                    })
                }
            }
        } else {
            // Peer pings / attributed deliveries land as role=user. Still scrape a
            // trailing AGENT_NOTIFY_SUMMARY so Session Log / inbox capture A2A status.
            const plainText = extractTextForLinkScoop(content)
            if (plainText) {
                primary = this.recordNotifyFromPlainText(session, messageId, plainText, ts, {
                    deliveryRole: 'user'
                })
            }
        }

        // Always scoop URLs from any ingestible message text (agent or user).
        this.scoopLinksFromContent(session, messageId, content, ts)
        return primary
    }

    onSessionUpdated(session: Session, tag?: string | null): void {
        this.syncPermissionRequests(session, tag ?? null)
    }

    onSessionEnd(
        session: Session,
        tag: string | null,
        ts: number,
        reason: string | undefined,
        getLastAgentPlainText: () => string | null
    ): StoredSystemEvent | null {
        this.knownPermissionRequestIds.delete(session.id)

        if (reason !== 'completed') {
            return null
        }

        const lastText = getLastAgentPlainText()
        if (lastText && extractNotifySummary(lastText)) {
            return null
        }

        const snapshot = toSessionSnapshot(session, tag)
        return this.insertSystemEvent(snapshot, {
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
        const sourceRef = notify.agent ?? notify.project ?? session.tag ?? session.id

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
                suggested_action: notify.action ?? null,
                ...extras
            },
            notifyProject: notify.project ?? null,
            severity: deriveSeverity(eventType),
            tags: buildTags(notify, session.flavor)
        })
    }

    private syncPermissionRequests(session: Session, tag: string | null): void {
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
            const request = asRecord(requests[requestId])
            const toolName = typeof request?.tool === 'string' ? request.tool : 'tool'
            const summary = `Permission requested: ${toolName}`
            this.insertSystemEvent(snapshot, {
                ts: Date.now(),
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
            })
        }

        this.knownPermissionRequestIds.set(session.id, currentIds)
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
