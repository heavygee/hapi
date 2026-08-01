import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from '../sync/syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'
import {
    assembleOverseerConverseMessages,
    budgetConvoTurns,
    DEFAULT_CONVERSE_HISTORY_MAX_CHARS,
    listRecentConvoTurns,
    parseConvoTurnPayload
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
        const list = listRecentConvoTurns(overseer, { limit: 10 })
        expect(list.map((t) => t.operatorText)).toEqual(['first', 'second'])
    })
})
