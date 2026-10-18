import { describe, expect, it } from 'bun:test'
import {
    SESSION_START_TIMEOUT_MS_DEFAULT,
    SESSION_START_TIMEOUT_MS_MAX,
    SESSION_START_TIMEOUT_MS_MIN,
    clampSessionStartTimeoutMs
} from './sessionStartTimeout'

describe('clampSessionStartTimeoutMs', () => {
    it('keeps values inside the supported range', () => {
        expect(clampSessionStartTimeoutMs(SESSION_START_TIMEOUT_MS_DEFAULT)).toBe(SESSION_START_TIMEOUT_MS_DEFAULT)
        expect(clampSessionStartTimeoutMs(60_000)).toBe(60_000)
    })

    it('clamps to the floor and ceiling', () => {
        expect(clampSessionStartTimeoutMs(1)).toBe(SESSION_START_TIMEOUT_MS_MIN)
        expect(clampSessionStartTimeoutMs(24 * 60 * 60 * 1000)).toBe(SESSION_START_TIMEOUT_MS_MAX)
    })

    it('rounds fractional milliseconds', () => {
        expect(clampSessionStartTimeoutMs(30_000.6)).toBe(30_001)
    })

    it('returns null for unusable values so callers can fall back to the default', () => {
        expect(clampSessionStartTimeoutMs(0)).toBeNull()
        expect(clampSessionStartTimeoutMs(-1)).toBeNull()
        expect(clampSessionStartTimeoutMs(Number.NaN)).toBeNull()
        expect(clampSessionStartTimeoutMs(Number.POSITIVE_INFINITY)).toBeNull()
        expect(clampSessionStartTimeoutMs(undefined)).toBeNull()
        expect(clampSessionStartTimeoutMs(null)).toBeNull()
        expect(clampSessionStartTimeoutMs('not a number')).toBeNull()
    })

    it('accepts numeric strings from JSON/env style sources', () => {
        expect(clampSessionStartTimeoutMs('45000')).toBe(45_000)
    })
})
