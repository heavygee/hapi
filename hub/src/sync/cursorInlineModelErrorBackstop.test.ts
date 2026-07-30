import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { MetadataSchema } from '@hapi/protocol/schemas'
import {
    extractCursorInlineClassifiableText,
    tryPromoteCursorInlineModelErrorFromMessage
} from './cursorInlineModelErrorBackstop'

function makeStore(): Store {
    return new Store(':memory:')
}

function cursorAgentErrorMessage(text: string) {
    return {
        role: 'agent',
        content: {
            type: 'codex',
            data: {
                type: 'message',
                message: text
            }
        }
    }
}

describe('cursorInlineModelErrorBackstop', () => {
    it('extracts classifiable text from codex-shaped agent messages', () => {
        const text = extractCursorInlineClassifiableText(
            cursorAgentErrorMessage('\n\nError: RetriableError: WritableIterable is closed')
        )
        expect(text).toBe('\n\nError: RetriableError: WritableIterable is closed')
    })

    it('promotes transport_closed metadata for cursor sessions when missing', () => {
        const store = makeStore()
        const session = store.sessions.getOrCreateSession(
            'cursor-backstop',
            { path: '/tmp/cursor-backstop', host: 'localhost', flavor: 'cursor' },
            null,
            'default'
        )

        store.messages.addMessage(
            session.id,
            { role: 'user', content: { type: 'text', text: 'fix the arr stack' } },
            'user-1'
        )

        const content = cursorAgentErrorMessage('\n\nError: RetriableError: WritableIterable is closed')
        const msg = store.messages.addMessage(session.id, content, 'agent-1')

        const promoted = tryPromoteCursorInlineModelErrorFromMessage({
            store,
            sessionId: session.id,
            session,
            content,
            atTs: msg.createdAt,
            messageSeq: msg.seq
        })

        expect(promoted).toBe(true)

        const updated = store.sessions.getSession(session.id)
        const parsed = MetadataSchema.safeParse(updated?.metadata)
        expect(parsed.success).toBe(true)
        if (!parsed.success) {
            throw new Error('metadata parse failed')
        }
        expect(parsed.data.lastModelError?.kind).toBe('transport_closed')
        expect(parsed.data.lastModelError?.transient).toBe(true)
        expect(parsed.data.lastModelError?.rawSnippet).toContain('WritableIterable is closed')
        expect(parsed.data.lastModelError?.lastUserMessage).toBe('fix the arr stack')
    })

    it('does not duplicate promotion for the same unacknowledged error', () => {
        const store = makeStore()
        const session = store.sessions.getOrCreateSession(
            'cursor-backstop-dedupe',
            { path: '/tmp/cursor-backstop-dedupe', host: 'localhost', flavor: 'cursor' },
            null,
            'default'
        )

        const content = cursorAgentErrorMessage('\n\nError: T: WritableIterable is closed')
        const msg = store.messages.addMessage(session.id, content, 'agent-1')

        expect(tryPromoteCursorInlineModelErrorFromMessage({
            store,
            sessionId: session.id,
            session,
            content,
            atTs: msg.createdAt,
            messageSeq: msg.seq
        })).toBe(true)

        const refreshed = store.sessions.getSession(session.id)
        if (!refreshed) {
            throw new Error('session missing')
        }

        expect(tryPromoteCursorInlineModelErrorFromMessage({
            store,
            sessionId: session.id,
            session: refreshed,
            content,
            atTs: msg.createdAt + 1,
            messageSeq: msg.seq + 1
        })).toBe(false)
    })
})
