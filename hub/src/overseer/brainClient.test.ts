import { describe, expect, it } from 'vitest'
import { listBrainProfiles, resolveBrainConfig } from './brainClient'

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

    it('falls back to default for an unknown profile', () => {
        expect(resolveBrainConfig(multiEnv, { profile: 'nope' })?.baseUrl).toBe('http://local.test/v1')
    })

    it('model override wins over the selected profile model', () => {
        expect(resolveBrainConfig(multiEnv, { profile: 'openai', model: 'gpt-4o-mini' })?.model).toBe('gpt-4o-mini')
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
