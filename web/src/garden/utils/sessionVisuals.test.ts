import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    ATTENTION_COLOR,
    DWELL_SECONDS,
    filterGardenSessions,
    layoutPosition,
    sessionColor,
    sessionLabel,
} from '@/garden/utils/sessionVisuals'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        model: null,
        effort: null,
        ...overrides,
    }
}

describe('layoutPosition', () => {
    it('places a single orb centered on the arc', () => {
        const [x, , z] = layoutPosition(0, 1)
        expect(x).toBeCloseTo(0, 5)
        expect(z).toBeLessThan(0)
    })

    it('spreads multiple orbs across a 270 degree arc', () => {
        const left = layoutPosition(0, 3)[0]
        const right = layoutPosition(2, 3)[0]
        expect(left).toBeLessThan(0)
        expect(right).toBeGreaterThan(0)
    })

    it('staggers y by index mod 3', () => {
        const y0 = layoutPosition(0, 5)[1]
        const y3 = layoutPosition(3, 5)[1]
        expect(y3).toBe(y0)
    })
})

describe('sessionLabel', () => {
    it('prefers summary text', () => {
        const session = makeSession({
            id: 'abc12345',
            metadata: { path: '/foo/bar', summary: { text: 'Fix the garden tests' } },
        })
        expect(sessionLabel(session)).toBe('Fix the garden tests')
    })

    it('falls back to path basename', () => {
        const session = makeSession({
            id: 'abc12345',
            metadata: { path: '/home/heavygee/coding/hapi' },
        })
        expect(sessionLabel(session)).toBe('hapi')
    })

    it('falls back to id prefix', () => {
        expect(sessionLabel(makeSession({ id: 'deadbeef' }))).toBe('deadbeef')
    })
})

describe('sessionColor', () => {
    it('prioritizes pending over thinking and active', () => {
        expect(sessionColor(makeSession({ id: 'a', pendingRequestsCount: 1, thinking: true, active: true }))).toBe('#ef4444')
    })

    it('uses thinking color when pending is zero', () => {
        expect(sessionColor(makeSession({ id: 'a', thinking: true, active: true }))).toBe('#eab308')
    })

    it('uses active color when idle flags are false', () => {
        expect(sessionColor(makeSession({ id: 'a', active: true }))).toBe('#22d3ee')
    })
})

describe('filterGardenSessions', () => {
    it('keeps active, thinking, or pending sessions only', () => {
        const sessions = [
            makeSession({ id: 'idle', updatedAt: 999 }),
            makeSession({ id: 'active', active: true, updatedAt: 100 }),
            makeSession({ id: 'thinking', thinking: true, updatedAt: 200 }),
            makeSession({ id: 'pending', pendingRequestsCount: 1, updatedAt: 50 }),
        ]
        const visible = filterGardenSessions(sessions)
        expect(visible.map((s) => s.id)).toEqual(['thinking', 'active', 'pending'])
    })

    it('caps at eight sessions', () => {
        const sessions = Array.from({ length: 12 }, (_, index) =>
            makeSession({ id: `s${index}`, active: true, updatedAt: index })
        )
        expect(filterGardenSessions(sessions)).toHaveLength(8)
    })
})

describe('garden constants', () => {
    it('exports stable tuning values', () => {
        expect(DWELL_SECONDS).toBe(1.2)
        expect(ATTENTION_COLOR).toBe('#f97316')
    })
})
