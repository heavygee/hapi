import { describe, expect, it } from 'vitest'
import { smoothLevel, rmsFromPcm16Base64 } from '@/realtime/voiceAudioLevels'

describe('smoothLevel', () => {
    it('moves toward target', () => {
        expect(smoothLevel(0, 1, 0.5)).toBe(0.5)
    })

    it('returns target when factor is 1', () => {
        expect(smoothLevel(0.2, 0.9, 1)).toBeCloseTo(0.9)
    })

    it('holds when factor is 0', () => {
        expect(smoothLevel(0.4, 1, 0)).toBe(0.4)
    })
})

function pcm16Base64FromSamples(samples: number[]): string {
    const bytes = new Uint8Array(samples.length * 2)
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-32768, Math.min(32767, samples[i] | 0))
        bytes[i * 2] = s & 0xff
        bytes[i * 2 + 1] = (s >> 8) & 0xff
    }
    let bin = ''
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i])
    }
    return btoa(bin)
}

describe('rmsFromPcm16Base64', () => {
    it('returns 0 for an empty string', () => {
        expect(rmsFromPcm16Base64('')).toBe(0)
    })

    it('returns 0 for malformed base64', () => {
        // atob will throw on invalid input; helper must catch and return 0
        expect(rmsFromPcm16Base64('!!!not-base64!!!')).toBe(0)
    })

    it('returns 0 for silence (all-zero samples)', () => {
        const b64 = pcm16Base64FromSamples([0, 0, 0, 0, 0, 0, 0, 0])
        expect(rmsFromPcm16Base64(b64)).toBe(0)
    })

    it('returns a positive level for a loud signal', () => {
        const samples = []
        for (let i = 0; i < 64; i++) {
            samples.push(i % 2 === 0 ? 16000 : -16000)
        }
        const level = rmsFromPcm16Base64(pcm16Base64FromSamples(samples))
        expect(level).toBeGreaterThan(0.5)
        expect(level).toBeLessThanOrEqual(1)
    })

    it('caps at 1 for a clipped signal', () => {
        const samples = new Array(64).fill(0).map((_, i) => (i % 2 === 0 ? 32767 : -32768))
        const level = rmsFromPcm16Base64(pcm16Base64FromSamples(samples))
        expect(level).toBeGreaterThan(0.9)
        expect(level).toBeLessThanOrEqual(1)
    })

    it('quiet signal yields a small level', () => {
        const samples = new Array(64).fill(0).map((_, i) => (i % 2 === 0 ? 200 : -200))
        const level = rmsFromPcm16Base64(pcm16Base64FromSamples(samples))
        expect(level).toBeGreaterThan(0)
        expect(level).toBeLessThan(0.05)
    })
})
