import { describe, expect, it } from 'vitest'
import { shedToolbarSlots, toolbarActionBudget, toolbarGutterPx, TOOLBAR_ICON_PX } from './sessionToolbarShed'

const icon = (id: string, keep: number) => ({ id, keep, widthPx: TOOLBAR_ICON_PX })

describe('shedToolbarSlots', () => {
    const slots = [
        icon('unread', 5),
        icon('mark-all', 7),
        icon('new', 4),
        icon('settings', 6),
        icon('browse', 8)
    ]

    it('keeps every slot when the row has room', () => {
        const result = shedToolbarSlots(slots, 400)
        expect(result.overflowIds).toEqual([])
        expect(result.visibleIds).toEqual(['unread', 'mark-all', 'new', 'settings', 'browse'])
    })

    it('sheds browse, then mark-all, then settings — new stays', () => {
        // More is the same width as an icon, so shedding one control does
        // not free a slot. Three survivors + More is the first fit.
        const threePlusMore = 40 * 3 + 40 + 4 * 3
        const tight = shedToolbarSlots(slots, threePlusMore)
        expect(tight.visibleIds).toEqual(['unread', 'new', 'settings'])
        expect(tight.overflowIds).toEqual(['mark-all', 'browse'])

        const twoPlusMore = 40 * 2 + 40 + 4 * 2
        const tighter = shedToolbarSlots(slots, twoPlusMore)
        expect(tighter.visibleIds).toEqual(['unread', 'new'])
        expect(tighter.overflowIds).toEqual(['mark-all', 'settings', 'browse'])
    })

    it('keeps the next icon when the hole is one gap short of its width', () => {
        // blocked 110 + new 40 + filter 40 + More 40 + 3 gaps = 242.
        // A 238px gutter leaves a 40px hole if filter is shed — one icon, minus the gap.
        const slots = [
            { id: 'blocked', keep: 2, widthPx: 110 },
            { id: 'new', keep: 4, widthPx: 40 },
            { id: 'filter', keep: 5, widthPx: 40 },
        ]
        const result = shedToolbarSlots(slots, 238)
        expect(result.visibleIds).toEqual(['blocked', 'new', 'filter'])
        expect(result.overflowIds).toEqual([])
    })

    it('drops new only after the lower-priority controls are already in More', () => {
        // New + More. A single equal-width icon cannot be swapped for More
        // without also shedding the next one — More occupies a slot too.
        const result = shedToolbarSlots(slots, 40 + 40 + 4)
        expect(result.visibleIds).toEqual(['new'])
        expect(result.overflowIds).toEqual(['unread', 'mark-all', 'settings', 'browse'])
    })
})

describe('toolbarActionBudget', () => {
    it('leaves a Quest-width empty row enough room for the daily controls', () => {
        expect(toolbarActionBudget(400, false)).toBeGreaterThan(200)
        expect(toolbarActionBudget(320, false)).toBeGreaterThan(200)
    })

    it('reserves only the compact query chip, not a 200px desert', () => {
        // max-w-[9rem] + clear ≈ 152. Old 200 left empty space after More on Quest.
        expect(toolbarActionBudget(400, true)).toBeGreaterThanOrEqual(220)
        expect(toolbarActionBudget(320, true)).toBeGreaterThanOrEqual(140)
        expect(toolbarActionBudget(320, true)).toBeLessThan(toolbarActionBudget(320, false))
    })

    it('measures the gutter to the row edge, not a guessed search reserve', () => {
        // Actions start at 160. Row border ends at 560. 8px of padding.
        // 392px fits every icon, so More stays empty.
        const gutter = toolbarGutterPx(160, 560, 8)
        expect(gutter).toBe(392)
        const slots = [
            { id: 'blocked', keep: 2, widthPx: 110 },
            icon('filter', 5),
            icon('new', 4),
            icon('settings', 6),
            icon('browse', 8),
            icon('overseer', 9),
            icon('import', 10),
        ]
        const result = shedToolbarSlots(slots, gutter)
        expect(result.overflowIds).toEqual([])
        expect(result.visibleIds).toContain('import')
        expect(result.visibleIds).toContain('browse')
    })

    it('uses a finite unmeasured budget so first paint can still shed', () => {
        expect(toolbarActionBudget(0, false)).toBe(280)
        expect(toolbarActionBudget(0, true)).toBe(220)
        const soupExtras = [
            icon('blocked', 2),
            icon('filter', 5),
            icon('new', 4),
            icon('settings', 6),
            icon('browse', 8),
            icon('overseer', 9),
            icon('import', 10),
        ]
        const firstPaint = shedToolbarSlots(soupExtras, toolbarActionBudget(0, false))
        expect(firstPaint.overflowIds).toContain('import')
        expect(firstPaint.overflowIds).toContain('overseer')
        expect(firstPaint.visibleIds).toContain('new')
        expect(firstPaint.visibleIds).toContain('filter')
    })
})
