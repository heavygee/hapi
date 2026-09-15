import { describe, expect, it, mock } from 'bun:test'
import {
    OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT,
    createOverseerLlmFallbackClient,
    extractTextFromChatCompletionsBody,
    extractTextFromResponsesBody,
    parseNotifySummaryFromLlmText,
    type OverseerLlmFetch,
} from './overseerLlmFallback'
import type { OverseerLlmFallbackEnabledConfig } from './overseerLlmFallbackConfig'

const baseConfig: OverseerLlmFallbackEnabledConfig = {
    enabled: true,
    baseUrl: 'http://llm.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    api: 'chat-completions',
    timeoutMs: 5_000,
}

describe('parseNotifySummaryFromLlmText', () => {
    it('parses a bare AGENT_NOTIFY_SUMMARY line', () => {
        const text = 'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Review PR","summary":"Shipped fix"}'
        const notify = parseNotifySummaryFromLlmText(text)
        expect(notify?.status).toBe('done')
        expect(notify?.summary).toBe('Shipped fix')
        expect(notify?.action).toBe('Review PR')
    })

    it('strips markdown fences before parse', () => {
        const text = '```\nAGENT_NOTIFY_SUMMARY {"status":"blocked","summary":"Waiting on review"}\n```'
        expect(parseNotifySummaryFromLlmText(text)?.summary).toBe('Waiting on review')
    })

    it('returns null for empty or non-compliant text', () => {
        expect(parseNotifySummaryFromLlmText('')).toBeNull()
        expect(parseNotifySummaryFromLlmText('just a paragraph')).toBeNull()
        expect(parseNotifySummaryFromLlmText('AGENT_NOTIFY_SUMMARY {}')).toBeNull()
        expect(parseNotifySummaryFromLlmText('AGENT_NOTIFY_SUMMARY {"status":"done"}')).toBeNull()
        expect(parseNotifySummaryFromLlmText('AGENT_NOTIFY_SUMMARY {"summary":"no status"}')).toBeNull()
        expect(parseNotifySummaryFromLlmText('AGENT_NOTIFY_SUMMARY {"status":"nope","summary":"bad status"}')).toBeNull()
    })
})

describe('response body extractors', () => {
    it('reads chat completions choices[0].message.content', () => {
        expect(extractTextFromChatCompletionsBody({
            choices: [{ message: { content: 'AGENT_NOTIFY_SUMMARY {"status":"done","summary":"ok"}' } }],
        })).toContain('AGENT_NOTIFY_SUMMARY')
    })

    it('reads responses output_text when present', () => {
        expect(extractTextFromResponsesBody({
            output_text: 'AGENT_NOTIFY_SUMMARY {"status":"failed","summary":"boom"}',
        })).toContain('failed')
    })

    it('aggregates responses output message content text parts', () => {
        expect(extractTextFromResponsesBody({
            output: [{
                type: 'message',
                content: [{ type: 'output_text', text: 'AGENT_NOTIFY_SUMMARY {"status":"stalled","summary":"idle"}' }],
            }],
        })).toContain('stalled')
    })
})

describe('createOverseerLlmFallbackClient', () => {
    it('POSTs chat completions with full turn text and parses notify', async () => {
        const fetchMock = mock(async (input: string, init?: RequestInit) => {
            expect(input).toBe('http://llm.test/v1/chat/completions')
            expect(init?.method).toBe('POST')
            const headers = init?.headers as Record<string, string>
            expect(headers.Authorization).toBe('Bearer test-key')
            const body = JSON.parse(String(init?.body)) as {
                model: string
                messages: Array<{ role: string; content: string }>
            }
            expect(body.model).toBe('test-model')
            expect(body.messages[0]?.role).toBe('system')
            expect(body.messages[0]?.content).toBe(OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT)
            expect(body.messages[1]?.content).toContain('FULL TURN BODY THAT IS LONG')
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: 'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"Merge","summary":"Turn complete"}',
                    },
                }],
            }), { status: 200, headers: { 'content-type': 'application/json' } })
        })

        const client = createOverseerLlmFallbackClient(baseConfig, {
            fetchImpl: fetchMock as unknown as OverseerLlmFetch,
        })
        const notify = await client.synthesizeNotifySummary('FULL TURN BODY THAT IS LONG\nline two')
        expect(notify?.summary).toBe('Turn complete')
        expect(notify?.status).toBe('done')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('POSTs /responses when api=responses and uses store:false', async () => {
        const fetchMock = mock(async (input: string, init?: RequestInit) => {
            expect(input).toBe('http://llm.test/v1/responses')
            const body = JSON.parse(String(init?.body)) as {
                model: string
                store: boolean
                instructions: string
                input: string
            }
            expect(body.store).toBe(false)
            expect(body.instructions).toBe(OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT)
            expect(body.input).toContain('assistant turn text')
            expect(body.model).toBe('test-model')
            return new Response(JSON.stringify({
                output_text: 'AGENT_NOTIFY_SUMMARY {"status":"needs_review","summary":"Please look"}',
            }), { status: 200 })
        })

        const client = createOverseerLlmFallbackClient(
            { ...baseConfig, api: 'responses' },
            { fetchImpl: fetchMock as unknown as OverseerLlmFetch },
        )
        const notify = await client.synthesizeNotifySummary('assistant turn text')
        expect(notify?.status).toBe('needs_review')
    })

    it('returns null on HTTP error so caller can fall through', async () => {
        const fetchMock = mock(async () => new Response('nope', { status: 500 }))
        const client = createOverseerLlmFallbackClient(baseConfig, {
            fetchImpl: fetchMock as unknown as OverseerLlmFetch,
        })
        expect(await client.synthesizeNotifySummary('text')).toBeNull()
    })

    it('returns null when model output is not a notify line', async () => {
        const fetchMock = mock(async () => new Response(JSON.stringify({
            choices: [{ message: { content: 'Sorry, I cannot help with that.' } }],
        }), { status: 200 }))
        const client = createOverseerLlmFallbackClient(baseConfig, {
            fetchImpl: fetchMock as unknown as OverseerLlmFetch,
        })
        expect(await client.synthesizeNotifySummary('text')).toBeNull()
    })

    it('returns null for empty turn text without calling fetch', async () => {
        const fetchMock = mock(async () => new Response('{}', { status: 200 }))
        const client = createOverseerLlmFallbackClient(baseConfig, {
            fetchImpl: fetchMock as unknown as OverseerLlmFetch,
        })
        expect(await client.synthesizeNotifySummary('   \n  ')).toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(0)
    })
})
