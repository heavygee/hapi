import { describe, expect, it } from 'bun:test'
import {
    OVERSEER_CONVO_TURN_EVENT_TYPE,
    OVERSEER_ENTITY_ID,
    OVERSEER_SOURCE_KIND,
    OVERSEER_TOOL_CATALOG,
    OVERSEER_TOOL_NAMES,
    buildOverseerConvoTurnEventInput,
    buildOverseerIdentity,
    buildOverseerSystemPrompt,
    deriveObservedWorkerState,
    inferWorkerState,
    isOverseerWriteTool,
    mapEventTypeToWorkerState,
    mapNotifyStatusToWorkerState,
    overseerToolArgsSchemas
} from './overseerEntity'

const STALE = 30 * 60 * 1000

describe('overseer entity protocol', () => {
    it('catalog covers every tool name; only record_disposition writes (R2)', () => {
        const catalogNames = OVERSEER_TOOL_CATALOG.map((t) => t.name).sort()
        expect(catalogNames).toEqual([...OVERSEER_TOOL_NAMES].sort())
        const writeTools = OVERSEER_TOOL_CATALOG.filter((t) => !t.readonly).map((t) => t.name)
        expect(writeTools).toEqual(['record_disposition'])
        expect(isOverseerWriteTool('record_disposition')).toBe(true)
        expect(isOverseerWriteTool('query_events')).toBe(false)
    })

    it('exposes a cannot-dispatch identity that CAN record dispositions (Stage 1)', () => {
        const identity = buildOverseerIdentity()
        expect(identity.id).toBe(OVERSEER_ENTITY_ID)
        expect(identity.kind).toBe(OVERSEER_SOURCE_KIND)
        expect(identity.canDispatch).toBe(false)
        expect(identity.canDisposition).toBe(true)
        expect(identity.tools).toHaveLength(OVERSEER_TOOL_NAMES.length)
    })

    it('system prompt frames chief-of-staff + read-only tools + disposition write discipline', () => {
        const prompt = buildOverseerSystemPrompt()
        expect(prompt).toContain('chief-of-staff')
        expect(prompt).toContain('Read-only tools')
        expect(prompt).toContain('record_disposition')
        expect(prompt).toContain('CANNOT dispatch')
        expect(prompt).toContain('Show receipts')
    })

    describe('worker state derivation', () => {
        it('maps notify status and event type to worker state', () => {
            expect(mapNotifyStatusToWorkerState('blocked')).toBe('blocked')
            expect(mapNotifyStatusToWorkerState('done')).toBe('complete')
            expect(mapNotifyStatusToWorkerState('needs_decision')).toBe('waiting_on_operator')
            expect(mapNotifyStatusToWorkerState(undefined)).toBe('unknown')
            expect(mapEventTypeToWorkerState('approval_requested')).toBe('waiting_on_operator')
            expect(mapEventTypeToWorkerState('tool_call')).toBe('working')
            expect(mapEventTypeToWorkerState('completed')).toBe('complete')
        })

        it('observed: pending request beats everything', () => {
            expect(deriveObservedWorkerState({
                active: true, thinking: true, silenceMs: 0, pendingRequestCount: 1, staleSilenceMs: STALE
            })).toBe('waiting_on_operator')
        })

        it('observed: thinking is working; inactive is idle; long silence is stale', () => {
            expect(deriveObservedWorkerState({
                active: true, thinking: true, silenceMs: 0, pendingRequestCount: 0, staleSilenceMs: STALE
            })).toBe('working')
            expect(deriveObservedWorkerState({
                active: false, thinking: false, silenceMs: 0, pendingRequestCount: 0, staleSilenceMs: STALE
            })).toBe('idle')
            expect(deriveObservedWorkerState({
                active: true, thinking: false, silenceMs: STALE + 1, pendingRequestCount: 0, staleSilenceMs: STALE
            })).toBe('stale')
        })
    })

    describe('inferWorkerState (contradiction-aware)', () => {
        it('terminal reported states win with high confidence', () => {
            const r = inferWorkerState({ reported: 'blocked', observed: 'idle', silenceMs: 0, staleSilenceMs: STALE })
            expect(r.state).toBe('blocked')
            expect(r.confidence).toBeGreaterThan(0.8)
        })

        it('reports working but long silence => stale with LOW confidence (does not paper over)', () => {
            const r = inferWorkerState({
                reported: 'working', observed: 'stale', silenceMs: STALE + 60_000, staleSilenceMs: STALE
            })
            expect(r.state).toBe('stale')
            expect(r.confidence).toBeLessThan(0.5)
            expect(r.note).toContain('possibly wedged')
        })

        it('falls back to observed when no report', () => {
            const r = inferWorkerState({ reported: null, observed: 'working', silenceMs: 0, staleSilenceMs: STALE })
            expect(r.state).toBe('working')
        })
    })

    describe('convo_turn event input', () => {
        it('is memory-bearing (attention_candidate=0) and overseer-sourced', () => {
            const input = buildOverseerConvoTurnEventInput({
                operatorText: 'who is blocked?',
                overseerText: 'peer-15 on CI auth',
                relatedSessionId: 'sess-1',
                toolCalls: [{ tool: 'query_inbox' }],
                ts: 1000
            })
            expect(input.eventType).toBe(OVERSEER_CONVO_TURN_EVENT_TYPE)
            expect(input.attentionCandidate).toBe(0)
            expect(input.operatorActionRequired).toBe(0)
            expect(input.sourceKind).toBe(OVERSEER_SOURCE_KIND)
            expect(input.relatedSessionId).toBe('sess-1')
            expect(input.summary).toContain('who is blocked?')
            const payload = JSON.parse(input.payloadJson) as { operatorText: string; overseerText: string; toolCalls: unknown[] }
            expect(payload.overseerText).toBe('peer-15 on CI auth')
            expect(payload.toolCalls).toHaveLength(1)
        })
    })

    describe('tool arg schemas', () => {
        it('rejects bad severity and accepts valid filter', () => {
            expect(overseerToolArgsSchemas.query_events.safeParse({ severityMin: 9 }).success).toBe(false)
            expect(overseerToolArgsSchemas.query_events.safeParse({ severityMin: 4, project: 'web' }).success).toBe(true)
            expect(overseerToolArgsSchemas.explain_priority.safeParse({ itemId: 0 }).success).toBe(false)
            expect(overseerToolArgsSchemas.explain_priority.safeParse({ itemId: 12 }).success).toBe(true)
        })
    })
})
