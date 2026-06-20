import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { extractLastMessageText } from '@/garden/utils/messageText'

function msg(overrides: Partial<DecryptedMessage> & { id: string; content: unknown }): DecryptedMessage {
    return {
        seq: null,
        localId: null,
        createdAt: 0,
        ...overrides,
    }
}

describe('extractLastMessageText', () => {
    it('returns the latest assistant plain string', () => {
        const messages = [
            msg({ id: '1', seq: 1, content: 'old' }),
            msg({ id: '2', seq: 2, content: { role: 'assistant', content: '  latest reply  ' } }),
        ]
        expect(extractLastMessageText(messages)).toBe('Agent: latest reply')
    })

    it('prefixes user messages', () => {
        const messages = [
            msg({ id: '1', seq: 1, content: { role: 'user', content: 'ship it' } }),
        ]
        expect(extractLastMessageText(messages)).toBe('You: ship it')
    })

    it('extracts text blocks from array content', () => {
        const messages = [
            msg({
                id: '1',
                seq: 1,
                content: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'line one' },
                        { type: 'text', text: 'line two' },
                    ],
                },
            }),
        ]
        expect(extractLastMessageText(messages)).toBe('Agent: line one\n\nline two')
    })

    it('unwraps codex-style output envelopes', () => {
        const messages = [
            msg({
                id: '1',
                seq: 1,
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: { content: 'done in garden' },
                    },
                },
            }),
        ]
        expect(extractLastMessageText(messages)).toBe('Agent: done in garden')
    })

    it('skips non-speakable tail messages', () => {
        const messages = [
            msg({ id: '1', seq: 1, content: { role: 'assistant', content: 'keep me' } }),
            msg({ id: '2', seq: 2, content: { type: 'tool_call', name: 'grep' } }),
        ]
        expect(extractLastMessageText(messages)).toBe('Agent: keep me')
    })

    it('returns null when nothing is speakable', () => {
        expect(extractLastMessageText([msg({ id: '1', content: { type: 'tool_call' } })])).toBeNull()
    })
})
