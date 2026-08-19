import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useVoiceInputPreferences } from './useVoiceInputPreferences'

function installPartialSpeechRecognition(available = vi.fn(() => Promise.resolve('available'))) {
    class MockSpeechRecognition {
        static available = available
        processLocally = false
    }
    Object.defineProperty(MockSpeechRecognition.prototype, 'processLocally', { value: false })
    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
    return available
}

describe('useVoiceInputPreferences', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('discovers browser-local support from its shape without probing available on mount', async () => {
        const available = installPartialSpeechRecognition()
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
            userAgentData: { platform: 'macOS', mobile: false },
            language: 'en-US'
        })
        const api = {
            fetchTranscriptionProviders: vi.fn(async () => ({ providers: [] }))
        }

        const { result } = renderHook(() => useVoiceInputPreferences(api as unknown as ApiClient))

        await waitFor(() => expect(result.current.provider).toBe('browser-local'))
        expect(available).not.toHaveBeenCalled()
    })

    it('excludes on-device browser-local but exposes browser-cloud on Android', async () => {
        // Android has no bundled on-device models and no trustworthy desktop UA-CH,
        // so browser-local must stay hidden. But the same `SpeechRecognition` global
        // is a valid classic/cloud constructor, so browser-cloud should appear —
        // this is the actual mobile parity path, not a relaxation of the on-device gate.
        const available = installPartialSpeechRecognition()
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15; WebView)', language: 'en-US' })
        const api = {
            fetchTranscriptionProviders: vi.fn(async () => ({
                providers: [{ id: 'openai', label: 'OpenAI', modes: ['standard', 'realtime'] }]
            }))
        }

        const { result } = renderHook(() => useVoiceInputPreferences(api as unknown as ApiClient))

        await waitFor(() => expect(result.current.providers).toHaveLength(2))
        const ids = result.current.providers.map((provider) => provider.id)
        expect(ids).toEqual(['openai', 'browser-cloud'])
        expect(result.current.provider).toBe('openai')
        expect(available).not.toHaveBeenCalled()
    })
})
