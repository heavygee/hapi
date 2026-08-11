/**
 * Opt-in hub LLM fallback for missing AGENT_NOTIFY_SUMMARY (fork issue #90).
 *
 * Default OFF. Enable only after primary emission miss rate is rare (~<5%).
 * Env-only for v1 — never surprise usage.
 *
 *   HAPI_OVERSEER_LLM_FALLBACK=1
 *   HAPI_OVERSEER_LLM_BASE_URL=http://127.0.0.1:11434/v1
 *   HAPI_OVERSEER_LLM_MODEL=llama3.3
 *   HAPI_OVERSEER_LLM_API_KEY=          # optional for local gateways
 *   HAPI_OVERSEER_LLM_API=chat-completions|responses   # default chat-completions
 *   HAPI_OVERSEER_LLM_TIMEOUT_MS=30000
 */

export type OverseerLlmApiMode = 'chat-completions' | 'responses'

export type OverseerLlmFallbackEnabledConfig = {
    enabled: true
    baseUrl: string
    apiKey: string
    model: string
    api: OverseerLlmApiMode
    timeoutMs: number
}

export type OverseerLlmFallbackDisabledConfig = {
    enabled: false
    reasonDisabled: 'flag_off' | 'incomplete_config' | 'invalid_api' | 'invalid_timeout' | 'invalid_base_url'
}

export type OverseerLlmFallbackConfig =
    | OverseerLlmFallbackEnabledConfig
    | OverseerLlmFallbackDisabledConfig

const DEFAULT_TIMEOUT_MS = 30_000
/** Node/Bun setTimeout clamps delays above 2^31-1 ms to 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647

function envTruthy(value: string | undefined): boolean {
    if (!value) return false
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function normalizeBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, '')
}

function isAbsoluteHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

function parseApiMode(raw: string | undefined): OverseerLlmApiMode | null {
    if (!raw || raw.trim() === '') return 'chat-completions'
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'chat-completions' || normalized === 'chat_completions' || normalized === 'chat') {
        return 'chat-completions'
    }
    if (normalized === 'responses' || normalized === 'response') {
        return 'responses'
    }
    return null
}

export function loadOverseerLlmFallbackConfig(
    env: NodeJS.ProcessEnv = process.env
): OverseerLlmFallbackConfig {
    if (!envTruthy(env.HAPI_OVERSEER_LLM_FALLBACK)) {
        return { enabled: false, reasonDisabled: 'flag_off' }
    }

    const baseUrlRaw = env.HAPI_OVERSEER_LLM_BASE_URL?.trim() ?? ''
    const model = env.HAPI_OVERSEER_LLM_MODEL?.trim() ?? ''
    if (!baseUrlRaw || !model) {
        return { enabled: false, reasonDisabled: 'incomplete_config' }
    }

    const api = parseApiMode(env.HAPI_OVERSEER_LLM_API)
    if (!api) {
        return { enabled: false, reasonDisabled: 'invalid_api' }
    }

    let timeoutMs = DEFAULT_TIMEOUT_MS
    const timeoutRaw = env.HAPI_OVERSEER_LLM_TIMEOUT_MS?.trim()
    if (timeoutRaw) {
        if (!/^\d+$/.test(timeoutRaw)) {
            return { enabled: false, reasonDisabled: 'invalid_timeout' }
        }
        const parsed = Number.parseInt(timeoutRaw, 10)
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
            return { enabled: false, reasonDisabled: 'invalid_timeout' }
        }
        timeoutMs = parsed
    }

    const baseUrl = normalizeBaseUrl(baseUrlRaw)
    if (!isAbsoluteHttpUrl(baseUrl)) {
        return { enabled: false, reasonDisabled: 'invalid_base_url' }
    }

    return {
        enabled: true,
        baseUrl,
        apiKey: env.HAPI_OVERSEER_LLM_API_KEY?.trim() ?? '',
        model,
        api,
        timeoutMs,
    }
}
