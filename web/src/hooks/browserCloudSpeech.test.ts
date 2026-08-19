import { describe, expect, it, vi } from 'vitest'
import { getBrowserCloudSpeechSupport, hasBrowserCloudSpeechSupport } from './browserCloudSpeech'

describe('browser-cloud speech capability detection', () => {
    it('detects the unprefixed SpeechRecognition constructor', () => {
        class MockSpeechRecognition {}
        expect(getBrowserCloudSpeechSupport({ speechRecognition: MockSpeechRecognition })).toBe(MockSpeechRecognition)
    })

    it('is a plain feature detection with no UA Client Hints gating', () => {
        // Unlike browser-local, there is no isConfirmedDesktopSpeechEnvironment
        // equivalent here — any environment exposing the constructor qualifies,
        // mobile included, since this path never touches the on-device bridge.
        class MockSpeechRecognition {}
        vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15; wv)', userAgentData: { platform: 'Android', mobile: true } })

        expect(hasBrowserCloudSpeechSupport()).toBe(true)

        vi.unstubAllGlobals()
    })

    it('returns null when neither SpeechRecognition nor webkitSpeechRecognition exist', () => {
        expect(getBrowserCloudSpeechSupport({ speechRecognition: undefined })).toBeNull()
    })

    it('rejects a non-function candidate', () => {
        expect(getBrowserCloudSpeechSupport({ speechRecognition: {} })).toBeNull()
    })
})
