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

/**
 * `kind` distinguishes a brain that is genuinely unreachable (network/timeout —
 * e.g. GPU pulled for VR) from one that answered with an error (http 4xx/5xx or
 * a malformed body). Callers use this so a chat-template 400 is not mislabeled
 * to the operator as "brain offline".
 */
export type BrainErrorKind = 'unreachable' | 'timeout' | 'http' | 'protocol'

export class BrainUnavailableError extends Error {
    constructor(
        message: string,
        readonly kind: BrainErrorKind = 'unreachable',
        readonly status?: number,
        readonly cause?: unknown
    ) {
        super(message)
        this.name = 'BrainUnavailableError'
    }

    /** True when the brain was reachable but the request itself failed. */
    get reachable(): boolean {
        return this.kind === 'http' || this.kind === 'protocol'
    }
}

export type OverseerBrainProfileInfo = {
    id: string
    label: string
    model: string
    isDefault: boolean
}

function timeoutFromEnv(env: NodeJS.ProcessEnv): number {
    return Number(env.OVERSEER_BRAIN_TIMEOUT_MS) > 0 ? Number(env.OVERSEER_BRAIN_TIMEOUT_MS) : 60_000
}

/** Read a brain config from a set of env keys with the given prefix. */
function readProfile(env: NodeJS.ProcessEnv, prefix: string): BrainConfig | null {
    const baseUrl = env[`${prefix}URL`]?.trim()
    if (!baseUrl) return null
    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        model: env[`${prefix}MODEL`]?.trim() || 'main',
        apiKey: env[`${prefix}API_KEY`]?.trim() || undefined,
        timeoutMs: timeoutFromEnv(env)
    }
}

/**
 * Resolve brain config from env, applying an optional profile + model override.
 *
 * Default profile: `OVERSEER_BRAIN_URL` / `_MODEL` / `_API_KEY`.
 * Named profiles: `OVERSEER_BRAIN_PROFILE_<ID>_URL` / `_MODEL` / `_API_KEY`
 * (so a frontier endpoint's key stays server-side, never in the browser).
 *
 * Returns null when the requested/default profile has no URL configured.
 */
export function resolveBrainConfig(
    env: NodeJS.ProcessEnv = process.env,
    opts: { profile?: string; model?: string } = {}
): BrainConfig | null {
    let cfg: BrainConfig | null = null
    const profile = opts.profile?.trim()
    if (profile && profile.toLowerCase() !== 'default') {
        cfg = readProfile(env, `OVERSEER_BRAIN_PROFILE_${profile.toUpperCase()}_`)
    }
    if (!cfg) cfg = readProfile(env, 'OVERSEER_BRAIN_')
    if (!cfg) return null
    const model = opts.model?.trim()
    return model ? { ...cfg, model } : cfg
}

const NON_CHAT_MODEL = /embedding|whisper|tts|dall-?e|moderation|audio|realtime|image|transcribe|-search|babbage|davinci-002|instruct/i

/** Keep the chat-usable model ids (drop embeddings/audio/image/etc.), sorted. */
export function filterChatModels(ids: string[]): string[] {
    const chat = ids.filter((id) => !NON_CHAT_MODEL.test(id))
    return (chat.length > 0 ? chat : ids).slice().sort()
}

/** List model ids a brain endpoint serves (OpenAI-compatible GET /models). */
export async function listBrainModels(config: BrainConfig, timeoutMs = 12_000): Promise<string[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
        res = await fetch(`${config.baseUrl}/models`, {
            headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
            signal: controller.signal
        })
    } catch (error) {
        throw new BrainUnavailableError('Brain model list unreachable', 'unreachable', undefined, error)
    } finally {
        clearTimeout(timeout)
    }
    if (!res.ok) throw new BrainUnavailableError(`Brain model list returned ${res.status}`, 'http', res.status)
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null
    return (json?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** List configured brain profiles for the UI (id/label/model only — no url/key). */
export function listBrainProfiles(env: NodeJS.ProcessEnv = process.env): OverseerBrainProfileInfo[] {
    const out: OverseerBrainProfileInfo[] = []
    const def = readProfile(env, 'OVERSEER_BRAIN_')
    if (def) out.push({ id: 'default', label: 'Default', model: def.model, isDefault: true })
    for (const key of Object.keys(env)) {
        const match = key.match(/^OVERSEER_BRAIN_PROFILE_(.+)_URL$/)
        if (!match) continue
        const id = match[1].toLowerCase()
        const cfg = readProfile(env, `OVERSEER_BRAIN_PROFILE_${match[1]}_`)
        if (cfg) out.push({ id, label: id, model: cfg.model, isDefault: false })
    }
    return out
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
        throw controller.signal.aborted
            ? new BrainUnavailableError('Overseer brain timed out', 'timeout', undefined, error)
            : new BrainUnavailableError('Overseer brain unreachable', 'unreachable', undefined, error)
    } finally {
        clearTimeout(timeout)
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new BrainUnavailableError(`Overseer brain returned ${res.status}: ${body.slice(0, 300)}`, 'http', res.status)
    }

    let json: unknown
    try {
        json = await res.json()
    } catch (error) {
        throw new BrainUnavailableError('Overseer brain returned invalid JSON', 'protocol', undefined, error)
    }

    const message = (json as { choices?: Array<{ message?: OpenAiChatMessage }> })?.choices?.[0]?.message
    if (!message) {
        throw new BrainUnavailableError('Overseer brain response missing a message', 'protocol')
    }
    return message
}
