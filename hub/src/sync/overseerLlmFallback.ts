import { extractNotifySummary, type NotifySummary } from '@hapi/protocol/messages'
import type { OverseerLlmFallbackEnabledConfig } from './overseerLlmFallbackConfig'

/**
 * Fixed system prompt for Option A hub LLM fallback.
 * Asks for exactly one AGENT_NOTIFY_SUMMARY line — same contract as primary agents.
 */
export const OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT = [
    'You summarize an AI coding agent turn for session tracking.',
    'Reply with exactly one line and nothing else (no markdown fences, no prose):',
    'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}',
    'Use status blocked if unsure. action must be concrete when status is done and follow-up remains.',
].join('\n')

export type OverseerLlmFallbackClient = {
    synthesizeNotifySummary(plainText: string): Promise<NotifySummary | null>
}

export type OverseerLlmFetch = (
    input: string,
    init?: RequestInit
) => Promise<Response>

export type OverseerLlmFallbackClientOptions = {
    fetchImpl?: OverseerLlmFetch
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strip common markdown fences so local models that wrap output still parse. */
function stripMarkdownFences(text: string): string {
    const trimmed = text.trim()
    const fenced = trimmed.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/u)
    if (fenced?.[1]) return fenced[1].trim()
    return trimmed
}

/**
 * Parse an AGENT_NOTIFY_SUMMARY from LLM output.
 * Uses the same end-anchored extractor as primary agent turns.
 */
export function parseNotifySummaryFromLlmText(text: string): NotifySummary | null {
    if (typeof text !== 'string' || text.trim().length === 0) return null
    return extractNotifySummary(stripMarkdownFences(text))
}

export function extractTextFromChatCompletionsBody(body: unknown): string | null {
    if (!isObject(body)) return null
    const choices = body.choices
    if (!Array.isArray(choices) || choices.length === 0) return null
    const first = choices[0]
    if (!isObject(first)) return null
    const message = first.message
    if (!isObject(message)) return null
    const content = message.content
    if (typeof content === 'string' && content.trim().length > 0) return content
    if (Array.isArray(content)) {
        const parts: string[] = []
        for (const part of content) {
            if (typeof part === 'string') parts.push(part)
            else if (isObject(part) && typeof part.text === 'string') parts.push(part.text)
        }
        const joined = parts.join('\n').trim()
        return joined.length > 0 ? joined : null
    }
    return null
}

export function extractTextFromResponsesBody(body: unknown): string | null {
    if (!isObject(body)) return null
    if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) {
        return body.output_text
    }
    const output = body.output
    if (!Array.isArray(output)) return null
    const parts: string[] = []
    for (const item of output) {
        if (!isObject(item)) continue
        if (item.type !== 'message') continue
        const content = item.content
        if (!Array.isArray(content)) continue
        for (const part of content) {
            if (!isObject(part)) continue
            if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
                parts.push(part.text)
            }
        }
    }
    const joined = parts.join('\n').trim()
    return joined.length > 0 ? joined : null
}

function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function createOverseerLlmFallbackClient(
    config: OverseerLlmFallbackEnabledConfig,
    options: OverseerLlmFallbackClientOptions = {}
): OverseerLlmFallbackClient {
    const fetchImpl: OverseerLlmFetch = options.fetchImpl
        ?? ((input, init) => fetch(input, init))

    return {
        async synthesizeNotifySummary(plainText: string): Promise<NotifySummary | null> {
            const turn = plainText.trim()
            if (!turn) return null

            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), config.timeoutMs)

            try {
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                }
                if (config.apiKey) {
                    headers.Authorization = `Bearer ${config.apiKey}`
                }

                let url: string
                let body: Record<string, unknown>
                if (config.api === 'responses') {
                    url = joinUrl(config.baseUrl, 'responses')
                    body = {
                        model: config.model,
                        instructions: OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT,
                        input: turn,
                        store: false,
                    }
                } else {
                    url = joinUrl(config.baseUrl, 'chat/completions')
                    body = {
                        model: config.model,
                        messages: [
                            { role: 'system', content: OVERSEER_LLM_FALLBACK_SYSTEM_PROMPT },
                            { role: 'user', content: turn },
                        ],
                    }
                }

                const response = await fetchImpl(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: controller.signal,
                })
                if (!response.ok) return null

                let parsed: unknown
                try {
                    parsed = await response.json()
                } catch {
                    return null
                }

                const text = config.api === 'responses'
                    ? extractTextFromResponsesBody(parsed)
                    : extractTextFromChatCompletionsBody(parsed)
                if (!text) return null
                return parseNotifySummaryFromLlmText(text)
            } catch {
                return null
            } finally {
                clearTimeout(timer)
            }
        },
    }
}
