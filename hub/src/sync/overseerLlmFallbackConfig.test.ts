import { afterEach, describe, expect, it } from 'bun:test'
import { loadOverseerLlmFallbackConfig, redactOverseerLlmBaseUrlForLog } from './overseerLlmFallbackConfig'

const ENV_KEYS = [
    'HAPI_OVERSEER_LLM_FALLBACK',
    'HAPI_OVERSEER_LLM_BASE_URL',
    'HAPI_OVERSEER_LLM_API_KEY',
    'HAPI_OVERSEER_LLM_MODEL',
    'HAPI_OVERSEER_LLM_API',
    'HAPI_OVERSEER_LLM_TIMEOUT_MS',
] as const

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function stashEnv(): void {
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key]
        delete process.env[key]
    }
}

function restoreEnv(): void {
    for (const key of ENV_KEYS) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
}

afterEach(() => {
    restoreEnv()
})

describe('loadOverseerLlmFallbackConfig', () => {
    it('defaults to disabled when env is unset', () => {
        stashEnv()
        const config = loadOverseerLlmFallbackConfig()
        expect(config.enabled).toBe(false)
        if (config.enabled) throw new Error('expected disabled')
        expect(config.reasonDisabled).toBe('flag_off')
    })

    it('stays disabled when flag is on but base URL or model missing', () => {
        stashEnv()
        process.env.HAPI_OVERSEER_LLM_FALLBACK = '1'
        process.env.HAPI_OVERSEER_LLM_MODEL = 'llama3.3'
        const config = loadOverseerLlmFallbackConfig()
        expect(config.enabled).toBe(false)
        if (config.enabled) throw new Error('expected disabled')
        expect(config.reasonDisabled).toBe('incomplete_config')
    })

    it('enables with chat-completions defaults when flag + url + model set', () => {
        stashEnv()
        process.env.HAPI_OVERSEER_LLM_FALLBACK = 'true'
        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'http://127.0.0.1:11434/v1'
        process.env.HAPI_OVERSEER_LLM_MODEL = 'llama3.3'
        const config = loadOverseerLlmFallbackConfig()
        expect(config.enabled).toBe(true)
        if (!config.enabled) throw new Error('expected enabled')
        expect(config.baseUrl).toBe('http://127.0.0.1:11434/v1')
        expect(config.model).toBe('llama3.3')
        expect(config.api).toBe('chat-completions')
        expect(config.apiKey).toBe('')
        expect(config.timeoutMs).toBe(30_000)
    })

    it('accepts responses api mode and custom timeout/key', () => {
        stashEnv()
        process.env.HAPI_OVERSEER_LLM_FALLBACK = '1'
        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://api.openai.com/v1/'
        process.env.HAPI_OVERSEER_LLM_MODEL = 'gpt-4.1-mini'
        process.env.HAPI_OVERSEER_LLM_API = 'responses'
        process.env.HAPI_OVERSEER_LLM_API_KEY = 'sk-test'
        process.env.HAPI_OVERSEER_LLM_TIMEOUT_MS = '12000'
        const config = loadOverseerLlmFallbackConfig()
        expect(config.enabled).toBe(true)
        if (!config.enabled) throw new Error('expected enabled')
        expect(config.baseUrl).toBe('https://api.openai.com/v1')
        expect(config.api).toBe('responses')
        expect(config.apiKey).toBe('sk-test')
        expect(config.timeoutMs).toBe(12_000)
    })

    it('rejects partially numeric timeout values', () => {
        stashEnv()
        process.env.HAPI_OVERSEER_LLM_FALLBACK = '1'
        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'http://127.0.0.1:11434/v1'
        process.env.HAPI_OVERSEER_LLM_MODEL = 'llama3.3'
        process.env.HAPI_OVERSEER_LLM_TIMEOUT_MS = '30s'
        const suffix = loadOverseerLlmFallbackConfig()
        expect(suffix.enabled).toBe(false)
        if (suffix.enabled) throw new Error('expected disabled')
        expect(suffix.reasonDisabled).toBe('invalid_timeout')

        process.env.HAPI_OVERSEER_LLM_TIMEOUT_MS = '1e3'
        const scientific = loadOverseerLlmFallbackConfig()
        expect(scientific.enabled).toBe(false)
        if (scientific.enabled) throw new Error('expected disabled')
        expect(scientific.reasonDisabled).toBe('invalid_timeout')

        process.env.HAPI_OVERSEER_LLM_TIMEOUT_MS = '2147483648'
        const overflow = loadOverseerLlmFallbackConfig()
        expect(overflow.enabled).toBe(false)
        if (overflow.enabled) throw new Error('expected disabled')
        expect(overflow.reasonDisabled).toBe('invalid_timeout')
    })

    it('rejects malformed fallback base URLs', () => {
        stashEnv()
        process.env.HAPI_OVERSEER_LLM_FALLBACK = '1'
        process.env.HAPI_OVERSEER_LLM_MODEL = 'llama3.3'
        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'localhost:11434/v1'
        const missingScheme = loadOverseerLlmFallbackConfig()
        expect(missingScheme.enabled).toBe(false)
        if (missingScheme.enabled) throw new Error('expected disabled')
        expect(missingScheme.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = '/'
        const slash = loadOverseerLlmFallbackConfig()
        expect(slash.enabled).toBe(false)
        if (slash.enabled) throw new Error('expected disabled')
        expect(slash.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://host/v1?tenant=x'
        const query = loadOverseerLlmFallbackConfig()
        expect(query.enabled).toBe(false)
        if (query.enabled) throw new Error('expected disabled')
        expect(query.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://host/v1#frag'
        const hash = loadOverseerLlmFallbackConfig()
        expect(hash.enabled).toBe(false)
        if (hash.enabled) throw new Error('expected disabled')
        expect(hash.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://user:secret@gateway/v1'
        const userinfo = loadOverseerLlmFallbackConfig()
        expect(userinfo.enabled).toBe(false)
        if (userinfo.enabled) throw new Error('expected disabled')
        expect(userinfo.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://host/v1?'
        const emptyQuery = loadOverseerLlmFallbackConfig()
        expect(emptyQuery.enabled).toBe(false)
        if (emptyQuery.enabled) throw new Error('expected disabled')
        expect(emptyQuery.reasonDisabled).toBe('invalid_base_url')

        process.env.HAPI_OVERSEER_LLM_BASE_URL = 'https://host/v1#'
        const emptyHash = loadOverseerLlmFallbackConfig()
        expect(emptyHash.enabled).toBe(false)
        if (emptyHash.enabled) throw new Error('expected disabled')
        expect(emptyHash.reasonDisabled).toBe('invalid_base_url')
    })

    it('redacts URL userinfo for startup logs', () => {
        expect(redactOverseerLlmBaseUrlForLog('https://user:secret@gateway/v1')).toBe(
            'https://REDACTED:REDACTED@gateway/v1'
        )
        expect(redactOverseerLlmBaseUrlForLog('https://gateway/v1')).toBe('https://gateway/v1')
        expect(redactOverseerLlmBaseUrlForLog('not a url')).toBe('[invalid-url]')
    })
})
