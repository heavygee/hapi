import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from '../sync/syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'
import {
    assembleOverseerConverseMessages,
    budgetConvoTurns,
    DEFAULT_CONVERSE_HISTORY_MAX_CHARS,
    listRecentConvoTurns,
    parseConvoTurnPayload,
    persistOverseerConvoExchange,
    sortConvoTurnsChronologically
} from './converseContext'

function buildEngine(store: Store): SyncEngine {
    const io = { of: () => ({ to: () => ({ emit: () => {}, timeout: () => ({ emit: () => {} }) }) }) } as never
    return new SyncEngine(store, io, new RpcRegistry(), { broadcast: () => {} } as never)
}

describe('converseContext assembler', () => {
    it('parseConvoTurnPayload reads operator/overseer/toolCalls', () => {
        const parsed = parseConvoTurnPayload(JSON.stringify({
            operatorText: 'What needs me?',
            overseerText: 'Three PRs.',
            toolCalls: [{ tool: 'query_inbox', argsSummary: '{"limit":10}' }]
        }))
        expect(parsed.operatorText).toBe('What needs me?')
        expect(parsed.overseerText).toBe('Three PRs.')
        expect(parsed.toolCalls[0]?.tool).toBe('query_inbox')
    })

    it('hydrates prior convo_turns and appends only the latest client operator line', () => {
        const store = new Store(':memory:')
        const engine = buildEngine(store)
        const overseer = engine.getOverseer()

        overseer.recordConvoTurn({
            operatorText: 'Which agents are blocked?',
            overseerText: 'None are blocked.',
            ts: 1000
        })
        overseer.recordConvoTurn({
            operatorText: 'What about expenses?',
            overseerText: 'Item #56 is waiting.',
            ts: 2000
        })

        const assembled = assembleOverseerConverseMessages({
            overseer,
            // Client still has stale local history + a new ask — hub ignores prior client turns.
            clientMessages: [
                { role: 'operator', content: 'stale local only' },
                { role: 'overseer', content: 'stale reply' },
                { role: 'operator', content: 'Ok next?' }
            ]
        })

        expect(assembled.hydratedTurns).toBe(2)
        expect(assembled.truncated).toBe(false)
        expect(assembled.messages.map((m) => m.role)).toEqual([
            'operator', 'overseer', 'operator', 'overseer', 'operator'
        ])
        expect(assembled.messages.map((m) => m.content)).toEqual([
            'Which agents are blocked?',
            'None are blocked.',
            'What about expenses?',
            'Item #56 is waiting.',
            'Ok next?'
        ])
        // Client stale lines never enter the brain context.
        expect(assembled.messages.some((m) => m.content.includes('stale'))).toBe(false)
    })

    it('budget drops oldest turns when over char budget (kill criterion)', () => {
        const turns = Array.from({ length: 8 }, (_, i) => ({
            id: i + 1,
            ts: 1000 + i,
            operatorText: `q${i} ${'x'.repeat(800)}`,
            overseerText: `a${i} ${'y'.repeat(800)}`,
            relatedSessionId: null,
            toolCalls: [] as Array<{ tool: import('@hapi/protocol').OverseerToolName; argsSummary?: string }>
        }))
        const { turns: kept, truncated } = budgetConvoTurns(turns, {
            maxTurns: 16,
            maxChars: 4_000
        })
        expect(truncated).toBe(true)
        expect(kept.length).toBeGreaterThan(0)
        expect(kept.length).toBeLessThan(8)
        expect(kept[0]!.id).toBeGreaterThan(1)

        // Unbounded dump must not survive default budget either when forced small.
        const tiny = budgetConvoTurns(turns, { maxTurns: 2, maxChars: DEFAULT_CONVERSE_HISTORY_MAX_CHARS })
        expect(tiny.turns.length).toBe(2)
        expect(tiny.truncated).toBe(true)
    })

    it('listRecentConvoTurns returns chronological views for UI hydrate', () => {
        const store = new Store(':memory:')
        const overseer = buildEngine(store).getOverseer()
        overseer.recordConvoTurn({ operatorText: 'first', overseerText: 'one', ts: 1 })
        overseer.recordConvoTurn({ operatorText: 'second', overseerText: 'two', ts: 2 })
        const { turns: list, clippedByLimit } = listRecentConvoTurns(overseer, { limit: 10 })
        expect(list.map((t) => t.operatorText)).toEqual(['first', 'second'])
        expect(clippedByLimit).toBe(false)
    })

    it('reports truncated when store query clipped older turns', () => {
        const store = new Store(':memory:')
        const overseer = buildEngine(store).getOverseer()
        for (let i = 0; i < 5; i++) {
            overseer.recordConvoTurn({
                operatorText: `q${i}`,
                overseerText: `a${i}`,
                ts: 1000 + i
            })
        }
        const assembled = assembleOverseerConverseMessages({
            overseer,
            clientMessages: [{ role: 'operator', content: 'now' }],
            maxTurns: 2
        })
        expect(assembled.hydratedTurns).toBe(2)
        expect(assembled.truncated).toBe(true)
        expect(assembled.messages.map((m) => m.content)).toEqual(['q3', 'a3', 'q4', 'a4', 'now'])
    })

    it('dedupes dangling operator retry after a completed pair', () => {
        const store = new Store(':memory:')
        const overseer = buildEngine(store).getOverseer()
        overseer.recordConvoTurn({ operatorText: 'done pair', overseerText: 'answered', ts: 1 })
        // Dangling operator-only row (empty overseer reply permitted by write path).
        overseer.recordConvoTurn({ operatorText: 'retry me', overseerText: '', ts: 2 })
        const assembled = assembleOverseerConverseMessages({
            overseer,
            clientMessages: [{ role: 'operator', content: 'retry me' }]
        })
        expect(assembled.messages.filter((m) => m.content === 'retry me')).toHaveLength(1)
        expect(assembled.messages.at(-1)).toEqual({ role: 'operator', content: 'retry me' })
        expect(assembled.completeDanglingTurnId).toBeTypeOf('number')
    })

    it('orders hydrated turns by ts with id tie-breaker (not insertion id)', () => {
        const store = new Store(':memory:')
        const overseer = buildEngine(store).getOverseer()
        overseer.recordConvoTurn({ operatorText: 'older-ts', overseerText: 'first', ts: 100 })
        overseer.recordConvoTurn({ operatorText: 'newer-ts', overseerText: 'second', ts: 300 })
        // Backfilled row: higher id but older ts should sort before the middle turn.
        overseer.recordConvoTurn({ operatorText: 'backfilled', overseerText: 'between', ts: 200 })

        const { turns } = listRecentConvoTurns(overseer, { limit: 10 })
        expect(turns.map((t) => t.operatorText)).toEqual(['older-ts', 'backfilled', 'newer-ts'])
    })

    it('sortConvoTurnsChronologically uses ts then id', () => {
        const sorted = sortConvoTurnsChronologically([
            { id: 3, ts: 200, operatorText: 'b', overseerText: '', relatedSessionId: null, toolCalls: [] },
            { id: 1, ts: 100, operatorText: 'a', overseerText: '', relatedSessionId: null, toolCalls: [] },
            { id: 2, ts: 200, operatorText: 'c', overseerText: '', relatedSessionId: null, toolCalls: [] }
        ])
        expect(sorted.map((t) => t.id)).toEqual([1, 2, 3])
    })

    it('persistOverseerConvoExchange completes a dangling turn instead of duplicating operator', () => {
        const store = new Store(':memory:')
        const overseer = buildEngine(store).getOverseer()
        const dangling = overseer.recordConvoTurn({ operatorText: 'retry me', overseerText: '', ts: 1 })
        expect(dangling).not.toBeNull()

        const assembled = assembleOverseerConverseMessages({
            overseer,
            clientMessages: [{ role: 'operator', content: 'retry me' }]
        })
        persistOverseerConvoExchange(overseer, assembled, {
            operatorText: 'retry me',
            overseerText: 'finally answered'
        })

        const { turns } = listRecentConvoTurns(overseer, { limit: 10 })
        expect(turns).toHaveLength(1)
        expect(turns[0]!.operatorText).toBe('retry me')
        expect(turns[0]!.overseerText).toBe('finally answered')
        expect(turns[0]!.id).toBe(dangling!.id)
    })
})
