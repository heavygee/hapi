import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    ATTENTION_COLOR,
    DWELL_SECONDS,
    GARDEN_VISIBLE_CAP,
    LAYOUT_ROW_PITCH_RAD,
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
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        attachedJob: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

describe('layoutPosition', () => {
    it('places a single orb on the horizon row', () => {
        const [x, y, z] = layoutPosition(0, 1)
        expect(x).toBeCloseTo(0, 5)
        expect(y).toBeCloseTo(0.38 + Math.sin(LAYOUT_ROW_PITCH_RAD) * 4.8, 3)
        expect(z).toBeLessThan(0)
    })

    it('stacks three elevation rows in the first column before spreading horizontally', () => {
        const top = layoutPosition(0, 6)[1]
        const mid = layoutPosition(1, 6)[1]
        const bottom = layoutPosition(2, 6)[1]
        expect(top).toBeGreaterThan(mid)
        expect(mid).toBeGreaterThan(bottom)
        const topX = layoutPosition(0, 6)[0]
        const midX = layoutPosition(1, 6)[0]
        expect(topX / midX).toBeCloseTo(Math.cos(LAYOUT_ROW_PITCH_RAD), 2)
    })

    it('spreads columns across a 270 degree arc', () => {
        const left = layoutPosition(0, 6)[0]
        const right = layoutPosition(3, 6)[0]
        expect(left).toBeLessThan(0)
        expect(right).toBeGreaterThan(0)
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
        expect(sessionColor(makeSession({ id: 'a', pendingRequestKinds: ['permission'], thinking: true, active: true }))).toBe('#ef4444')
    })

    it('uses thinking color when pending is zero', () => {
        expect(sessionColor(makeSession({ id: 'a', thinking: true, active: true }))).toBe('#eab308')
    })

    it('uses active color when idle flags are false', () => {
        expect(sessionColor(makeSession({ id: 'a', active: true }))).toBe('#22d3ee')
    })
})

describe('filterGardenSessions', () => {
    it('prioritizes hot sessions then fills with recent active', () => {
        const sessions = [
            makeSession({ id: 'idle-old', active: true, updatedAt: 10 }),
            makeSession({ id: 'active', active: true, updatedAt: 100 }),
            makeSession({ id: 'idle-new', active: true, updatedAt: 200 }),
            makeSession({ id: 'thinking', thinking: true, updatedAt: 50 }),
            makeSession({ id: 'archived', active: false, updatedAt: 999 }),
        ]
        const visible = filterGardenSessions(sessions)
        expect(visible.map((session) => session.id)).toEqual(['thinking', 'idle-new', 'active', 'idle-old'])
        expect(visible).not.toContainEqual(expect.objectContaining({ id: 'archived' }))
    })

    it(`caps at ${GARDEN_VISIBLE_CAP} sessions`, () => {
        const sessions = Array.from({ length: 30 }, (_, index) =>
            makeSession({ id: `s${index}`, active: true, updatedAt: index })
        )
        expect(filterGardenSessions(sessions)).toHaveLength(GARDEN_VISIBLE_CAP)
    })
})

describe('garden constants', () => {
    it('exports stable tuning values', () => {
        expect(DWELL_SECONDS).toBe(1.0)
        expect(ATTENTION_COLOR).toBe('#f97316')
    })
})
