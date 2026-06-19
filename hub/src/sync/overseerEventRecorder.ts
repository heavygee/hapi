import {
    buildEventSummaryFromNotify,
    deriveAttentionCandidate,
    deriveOperatorActionRequired,
    deriveSeverity,
    detectEmptyHapiEventsSentinel,
    detectMalformedNotifySummaryLine,
    mapNotifyStatusToEventType,
    OVERSEER_STALE_SILENCE_MS,
    isObject,
    type NotifySummary
} from '@hapi/protocol'
import {
    extractAssistantPlainText,
    extractNotifySummary,
    unwrapRoleWrappedRecordEnvelope
} from '@hapi/protocol/messages'
import type { Session } from '@hapi/protocol/types'
import type { EventStore, InsertSystemEventInput, StoredSystemEvent } from '../store'

type SessionSnapshot = {
    id: string
    flavor: string
    tag: string | null
    machineId: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return isObject(value) ? value as Record<string, unknown> : null
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

function buildPayloadJson(fields: Record<string, unknown>): string {
    return JSON.stringify(fields)
}

export class OverseerEventRecorder {
    private readonly lastAgentMessageAt = new Map<string, number>()
    private readonly emittedStaleSessions = new Set<string>()
    private readonly knownPermissionRequestIds = new Map<string, Set<string>>()

    constructor(private readonly events: EventStore) {}

    list(options: Parameters<EventStore['list']>[0] = {}): StoredSystemEvent[] {
        return this.events.list(options)
    }

    count(): number {
        return this.events.count()
    }

    onAgentMessage(session: SessionSnapshot, messageId: string, content: unknown, ts: number): StoredSystemEvent | null {
        if (!isAgentMessageContent(content)) {
            return null
        }

        this.lastAgentMessageAt.set(session.id, ts)
        this.emittedStaleSessions.delete(session.id)

        const agentBody = unwrapRoleWrappedRecordEnvelope(content)
        const agentContent = agentBody?.role === 'agent' ? agentBody.content : content

        const plainText = extractAssistantPlainText(agentContent)
        if (plainText) {
            if (detectEmptyHapiEventsSentinel(plainText)) {
                return this.insertSystemEvent({
                    ts,
                    sourceKind: 'system',
                    eventType: 'validation_error',
                    attentionCandidate: 0,
                    summary: 'Malformed HAPI_EVENTS sentinel block (empty body)',
                    relatedSessionId: session.id,
                    provenance: 'hub-inferred from empty HAPI_EVENTS sentinel pair',
                    idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:empty_hapi_events`,
                    payloadJson: buildPayloadJson({ messageId, plainTextPreview: plainText.slice(0, 500) }),
                    severity: 1
                })
            }

            if (detectMalformedNotifySummaryLine(plainText)) {
                return this.insertSystemEvent({
                    ts,
                    sourceKind: 'system',
                    eventType: 'validation_error',
                    attentionCandidate: 0,
                    summary: 'Malformed AGENT_NOTIFY_SUMMARY line on last turn',
                    relatedSessionId: session.id,
                    provenance: 'hub-inferred from malformed AGENT_NOTIFY_SUMMARY JSON',
                    idempotencyKey: `session:${session.id}:message:${messageId}:validation_error:malformed_notify`,
                    payloadJson: buildPayloadJson({ messageId }),
                    severity: 1
                })
            }

            const notify = extractNotifySummary(plainText)
            if (notify) {
                return this.recordNotifySummary(session, messageId, notify, ts)
            }
        }

        const toolFailure = extractToolFailureSummary(agentContent)
        if (toolFailure) {
            return this.insertSystemEvent({
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
                payloadJson: buildPayloadJson({ messageId }),
                severity: deriveSeverity('failed'),
                tags: buildTags(null, session.flavor)
            })
        }

        return null
    }

    onSessionUpdated(session: Session): void {
        this.syncPermissionRequests(session)
    }

    onSessionEnd(
        session: Session,
        ts: number,
        reason: string | undefined,
        getLastAgentPlainText: () => string | null
    ): StoredSystemEvent | null {
        this.emittedStaleSessions.delete(session.id)
        this.knownPermissionRequestIds.delete(session.id)

        if (reason !== 'completed') {
            return null
        }

        const lastText = getLastAgentPlainText()
        if (lastText && extractNotifySummary(lastText)) {
            return null
        }

        const flavor = session.metadata?.flavor ?? 'claude'
        return this.insertSystemEvent({
            ts,
            sourceKind: 'system',
            sourceRef: session.id,
            eventType: 'completed',
            attentionCandidate: 0,
            summary: 'Session ended without AGENT_NOTIFY_SUMMARY; hub inferred completion',
            relatedSessionId: session.id,
            provenance: 'hub-inferred from session-end completed signal',
            idempotencyKey: `session:${session.id}:session_end:${ts}:completed_fallback`,
            payloadJson: buildPayloadJson({ reason }),
            severity: deriveSeverity('completed'),
            tags: buildTags(null, flavor)
        })
    }

    checkStaleSessions(activeSessions: Session[], now: number = Date.now()): StoredSystemEvent[] {
        const emitted: StoredSystemEvent[] = []
        for (const session of activeSessions) {
            if (!session.active) continue
            if (this.emittedStaleSessions.has(session.id)) continue

            const requests = session.agentState?.requests
            if (requests && Object.keys(requests).length > 0) {
                continue
            }

            const lastAt = this.lastAgentMessageAt.get(session.id) ?? session.activeAt ?? session.updatedAt
            if (now - lastAt < OVERSEER_STALE_SILENCE_MS) {
                continue
            }

            const flavor = session.metadata?.flavor ?? 'claude'
            const event = this.insertSystemEvent({
                ts: now,
                sourceKind: 'system',
                sourceRef: session.id,
                eventType: 'stale',
                attentionCandidate: 1,
                operatorActionRequired: 0,
                summary: `No agent output for ${Math.round((now - lastAt) / 60_000)} minutes`,
                relatedSessionId: session.id,
                provenance: 'hub-inferred from session silence threshold',
                idempotencyKey: `session:${session.id}:stale:${Math.floor(lastAt / OVERSEER_STALE_SILENCE_MS)}`,
                payloadJson: buildPayloadJson({ lastAgentMessageAt: lastAt, thresholdMs: OVERSEER_STALE_SILENCE_MS }),
                severity: deriveSeverity('stale'),
                tags: buildTags(null, flavor)
            })
            if (event) {
                this.emittedStaleSessions.add(session.id)
                emitted.push(event)
            }
        }
        return emitted
    }

    seedLastAgentMessageAt(sessionId: string, ts: number): void {
        this.lastAgentMessageAt.set(sessionId, ts)
    }

    private recordNotifySummary(
        session: SessionSnapshot,
        messageId: string,
        notify: NotifySummary,
        ts: number
    ): StoredSystemEvent | null {
        const eventType = mapNotifyStatusToEventType(notify.status)
        const attentionCandidate = deriveAttentionCandidate(notify.status, notify.action)
        const operatorActionRequired = deriveOperatorActionRequired(notify.status, notify.action)
        const sourceRef = notify.agent ?? notify.project ?? session.tag ?? session.id

        return this.insertSystemEvent({
            ts,
            sourceKind: 'worker',
            sourceRef,
            eventType,
            attentionCandidate,
            operatorActionRequired,
            summary: buildEventSummaryFromNotify(notify),
            relatedSessionId: session.id,
            provenance: 'AGENT_NOTIFY_SUMMARY',
            idempotencyKey: `session:${session.id}:message:${messageId}:notify`,
            payloadJson: buildPayloadJson({
                messageId,
                notify_summary: notify,
                suggested_action: notify.action ?? null
            }),
            severity: deriveSeverity(eventType),
            tags: buildTags(notify, session.flavor)
        })
    }

    private syncPermissionRequests(session: Session): void {
        const requests = session.agentState?.requests ?? null
        if (!requests) {
            this.knownPermissionRequestIds.delete(session.id)
            return
        }

        const currentIds = new Set(Object.keys(requests))
        const known = this.knownPermissionRequestIds.get(session.id) ?? new Set<string>()

        for (const requestId of currentIds) {
            if (known.has(requestId)) continue
            const request = asRecord(requests[requestId])
            const toolName = typeof request?.tool === 'string' ? request.tool : 'tool'
            const summary = `Permission requested: ${toolName}`
            const flavor = session.metadata?.flavor ?? 'claude'
            this.insertSystemEvent({
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
                payloadJson: buildPayloadJson({ requestId, request }),
                severity: deriveSeverity('approval_requested'),
                tags: buildTags(null, flavor)
            })
        }

        this.knownPermissionRequestIds.set(session.id, currentIds)
    }

    private insertSystemEvent(input: Omit<InsertSystemEventInput, 'riskDetected'> & { riskDetected?: 0 | 1 }): StoredSystemEvent | null {
        return this.events.insert({
            riskDetected: 0,
            ...input
        })
    }
}

export function toSessionSnapshot(session: Session): SessionSnapshot {
    return {
        id: session.id,
        flavor: session.metadata?.flavor ?? 'claude',
        tag: session.metadata?.name ?? session.metadata?.path ?? null,
        machineId: null
    }
}

export function shouldInjectNotifyContract(flavor: string | undefined | null): boolean {
    return flavor !== 'cursor'
}
