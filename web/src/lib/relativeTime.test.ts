import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatAbsoluteDateTime, formatRelativeTime } from './relativeTime'

type TFunc = (key: string, params?: Record<string, string | number>) => string

const t: TFunc = (key, params) => {
    if (!params) return key
    let s = key
    for (const [k, v] of Object.entries(params)) {
        s = s.replaceAll(`{${k}}`, String(v))
    }
    return s
}

const keyed: TFunc = (key, params) => `${key}:${params?.n ?? ''}`

describe('formatRelativeTime', () => {
    const NOW = new Date('2026-07-14T12:00:00Z').getTime()
    const DAY = 24 * 60 * 60_000

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(NOW))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns just-now bucket for sub-minute deltas', () => {
        expect(formatRelativeTime(NOW - 30_000, t)).toBe('session.time.justNow')
    })

    it('returns minutes bucket for sub-hour deltas', () => {
        expect(formatRelativeTime(NOW - 5 * 60_000, keyed)).toBe('session.time.minutesAgo:5')
    })

    it('returns hours bucket for sub-day deltas', () => {
        expect(formatRelativeTime(NOW - 3 * 60 * 60_000, keyed)).toBe('session.time.hoursAgo:3')
    })

    it('returns days bucket through 13 days', () => {
        expect(formatRelativeTime(NOW - 4 * DAY, keyed)).toBe('session.time.daysAgo:4')
        expect(formatRelativeTime(NOW - 13 * DAY, keyed)).toBe('session.time.daysAgo:13')
    })

    it('returns weeks bucket between 2 weeks and under 2 months', () => {
        expect(formatRelativeTime(NOW - 15 * DAY, keyed)).toBe('session.time.weeksAgo:2')
        expect(formatRelativeTime(NOW - 45 * DAY, keyed)).toBe('session.time.weeksAgo:6')
    })

    it('returns months bucket from ~2 months until almost a year', () => {
        expect(formatRelativeTime(NOW - 70 * DAY, keyed)).toBe('session.time.monthsAgo:2')
        expect(formatRelativeTime(NOW - 300 * DAY, keyed)).toBe('session.time.monthsAgo:10')
    })

    it('returns almost-one-year for the final stretch under 365 days', () => {
        expect(formatRelativeTime(NOW - 340 * DAY, t)).toBe('session.time.almostOneYearAgo')
        expect(formatRelativeTime(NOW - 364 * DAY, t)).toBe('session.time.almostOneYearAgo')
    })

    it('falls back to a locale date string for >= 1 year', () => {
        const out = formatRelativeTime(NOW - 400 * DAY, t)
        expect(out).not.toMatch(/session\.time\./)
        expect(out).not.toBeNull()
    })

    it('treats Unix-second timestamps the same as ms (auto-detect)', () => {
        const secs = Math.floor((NOW - 30_000) / 1000)
        expect(formatRelativeTime(secs, t)).toBe('session.time.justNow')
    })

    it('returns null for non-finite values', () => {
        expect(formatRelativeTime(Number.NaN, t)).toBeNull()
        expect(formatRelativeTime(Number.POSITIVE_INFINITY, t)).toBeNull()
    })
})

describe('formatAbsoluteDateTime', () => {
    it('returns a non-null string for finite ms timestamps', () => {
        const out = formatAbsoluteDateTime(new Date('2026-07-14T12:00:00Z').getTime())
        expect(out).not.toBeNull()
        expect(typeof out).toBe('string')
    })

    it('returns null for non-finite values', () => {
        expect(formatAbsoluteDateTime(Number.NaN)).toBeNull()
        expect(formatAbsoluteDateTime(Number.POSITIVE_INFINITY)).toBeNull()
    })
})
