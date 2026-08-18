import { describe, expect, it } from 'vitest'
import { filterChatModels, isKnownBrainProfile, listBrainProfiles, resolveBrainConfig, resolveBrainSelection } from './brainClient'

const baseEnv = {
    OVERSEER_BRAIN_URL: 'http://local.test/v1/',
    OVERSEER_BRAIN_MODEL: 'main'
} as NodeJS.ProcessEnv

const multiEnv = {
    ...baseEnv,
    OVERSEER_BRAIN_PROFILE_OPENAI_URL: 'https://api.openai.com/v1',
    OVERSEER_BRAIN_PROFILE_OPENAI_MODEL: 'gpt-4o',
    OVERSEER_BRAIN_PROFILE_OPENAI_API_KEY: 'sk-test'
} as NodeJS.ProcessEnv

describe('resolveBrainConfig', () => {
    it('reads the default profile and trims the trailing slash', () => {
        const cfg = resolveBrainConfig(baseEnv)
        expect(cfg).toMatchObject({ baseUrl: 'http://local.test/v1', model: 'main' })
    })

    it('returns null when no brain url is configured', () => {
        expect(resolveBrainConfig({} as NodeJS.ProcessEnv)).toBeNull()
    })

    it('applies a per-request model override', () => {
        expect(resolveBrainConfig(baseEnv, { model: 'qwen3-32b' })?.model).toBe('qwen3-32b')
    })

    it('selects a named profile (case-insensitive) with its own key', () => {
        const cfg = resolveBrainConfig(multiEnv, { profile: 'openai' })
        expect(cfg).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' })
    })

    it('returns null for an unknown named profile (no silent fallback to env default)', () => {
        expect(resolveBrainConfig(multiEnv, { profile: 'nope' })).toBeNull()
    })

    it('uses only the env default when profile is explicitly default', () => {
        const cfg = resolveBrainConfig(multiEnv, { profile: 'default' })
        expect(cfg).toMatchObject({ baseUrl: 'http://local.test/v1', model: 'main' })
    })

    it('model override wins over the selected profile model', () => {
        expect(resolveBrainConfig(multiEnv, { profile: 'openai', model: 'gpt-4o-mini' })?.model).toBe('gpt-4o-mini')
    })
})

describe('resolveBrainSelection', () => {
    it('falls through to env default when nothing is set', () => {
        expect(resolveBrainSelection(null)).toEqual({ model: undefined })
    })

    it('uses the persisted active brain when no per-request override', () => {
        expect(resolveBrainSelection({ profile: 'openai', model: 'gpt-4o' })).toEqual({ profile: 'openai', model: 'gpt-4o' })
    })

    it('per-request profile overrides the active profile wholesale', () => {
        expect(resolveBrainSelection({ profile: 'openai', model: 'gpt-4o' }, { profile: 'default' }))
            .toEqual({ profile: 'default', model: undefined })
    })

    it('per-request model alone re-skins the active profile', () => {
        expect(resolveBrainSelection({ profile: 'openai', model: 'gpt-4o' }, { model: 'gpt-4o-mini' }))
            .toEqual({ profile: 'openai', model: 'gpt-4o-mini' })
    })

    it('active profile with null model resolves to profile default', () => {
        expect(resolveBrainSelection({ profile: 'local', model: null })).toEqual({ profile: 'local', model: undefined })
    })

    it('composes with resolveBrainConfig so the active brain becomes the effective config', () => {
        const cfg = resolveBrainConfig(multiEnv, resolveBrainSelection({ profile: 'openai', model: 'gpt-4o-mini' }))
        expect(cfg).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' })
    })
})

describe('listBrainProfiles', () => {
    it('lists the default plus named profiles (no url/key exposed)', () => {
        const list = listBrainProfiles(multiEnv)
        expect(list).toEqual([
            { id: 'default', label: 'Default', model: 'main', isDefault: true },
            { id: 'openai', label: 'openai', model: 'gpt-4o', isDefault: false }
        ])
    })

    it('is empty when no brain is configured', () => {
        expect(listBrainProfiles({} as NodeJS.ProcessEnv)).toEqual([])
    })
})

describe('isKnownBrainProfile', () => {
    it('returns true for configured profile ids and false otherwise', () => {
        expect(isKnownBrainProfile('default', multiEnv)).toBe(true)
        expect(isKnownBrainProfile('openai', multiEnv)).toBe(true)
        expect(isKnownBrainProfile('ghost', multiEnv)).toBe(false)
    })
})

describe('filterChatModels', () => {
    it('drops non-chat models and sorts the rest', () => {
        const filtered = filterChatModels([
            'gpt-4o',
            'text-embedding-3-small',
            'gpt-4.1',
            'whisper-1',
            'dall-e-3',
            'gpt-3.5-turbo-instruct',
            'tts-1'
        ])
        expect(filtered).toEqual(['gpt-4.1', 'gpt-4o'])
    })

    it('keeps a single local model id like "main"', () => {
        expect(filterChatModels(['main'])).toEqual(['main'])
    })

    it('falls back to the raw list when filtering removes everything', () => {
        expect(filterChatModels(['text-embedding-3-large'])).toEqual(['text-embedding-3-large'])
    })
})
