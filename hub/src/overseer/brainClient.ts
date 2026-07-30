/**
 * OpenAI-compatible client for the Overseer "brain" LLM.
 *
 * The brain is any OpenAI chat-completions endpoint that supports tool calling
 * (e.g. the estate `llama-server` serving Qwen3.6-27B at
 * `https://oos-llm.tail9944ee.ts.net/v1`, model `main`). It runs on contended
 * GPUs and can vanish (pulled for VR); every reachability failure is surfaced as
 * `BrainUnavailableError` so callers can degrade gracefully instead of erroring.
 */

export type BrainConfig = {
    /** Base URL including the `/v1` suffix. */
    baseUrl: string
    model: string
    apiKey?: string
    timeoutMs: number
}

export type OpenAiToolCall = {
    id?: string
    type?: 'function'
    function: { name: string; arguments: string }
}

export type OpenAiChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_calls?: OpenAiToolCall[]
    tool_call_id?: string
    name?: string
}

export type OverseerOpenAiToolLike = {
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
}

export class BrainUnavailableError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message)
        this.name = 'BrainUnavailableError'
    }
}

/** Resolve brain config from env; returns null when no brain URL is configured. */
export function resolveBrainConfig(env: NodeJS.ProcessEnv = process.env): BrainConfig | null {
    const baseUrl = env.OVERSEER_BRAIN_URL?.trim()
    if (!baseUrl) return null
    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        model: env.OVERSEER_BRAIN_MODEL?.trim() || 'main',
        apiKey: env.OVERSEER_BRAIN_API_KEY?.trim() || undefined,
        timeoutMs: Number(env.OVERSEER_BRAIN_TIMEOUT_MS) > 0 ? Number(env.OVERSEER_BRAIN_TIMEOUT_MS) : 60_000
    }
}

/**
 * One chat-completions round-trip. Returns the assistant message (which may
 * carry `tool_calls`). Throws `BrainUnavailableError` on any transport failure,
 * timeout, or non-2xx response.
 */
export async function callBrain(params: {
    config: BrainConfig
    messages: OpenAiChatMessage[]
    tools?: OverseerOpenAiToolLike[]
    temperature?: number
    signal?: AbortSignal
}): Promise<OpenAiChatMessage> {
    const { config, messages, tools, temperature = 0.2, signal } = params
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    let res: Response
    try {
        res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
            },
            body: JSON.stringify({
                model: config.model,
                messages,
                ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
                temperature,
                stream: false
            }),
            signal: controller.signal
        })
    } catch (error) {
        throw new BrainUnavailableError(
            controller.signal.aborted ? 'Overseer brain timed out' : 'Overseer brain unreachable',
            error
        )
    } finally {
        clearTimeout(timeout)
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new BrainUnavailableError(`Overseer brain returned ${res.status}: ${body.slice(0, 200)}`)
    }

    let json: unknown
    try {
        json = await res.json()
    } catch (error) {
        throw new BrainUnavailableError('Overseer brain returned invalid JSON', error)
    }

    const message = (json as { choices?: Array<{ message?: OpenAiChatMessage }> })?.choices?.[0]?.message
    if (!message) {
        throw new BrainUnavailableError('Overseer brain response missing a message')
    }
    return message
}
