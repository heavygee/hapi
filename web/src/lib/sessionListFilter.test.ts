import { describe, expect, it } from 'vitest'
import {
    DEFAULT_SESSION_LIST_FILTER_STATE,
    hasActiveSessionListFilter,
    isSessionListFilterSelected,
    SESSION_LIST_FILTER_OPTIONS,
    toggleSessionListFilter
} from './sessionListFilter'

describe('session list filter state', () => {
    it('toggles each condition independently so filters can be composed', () => {
        const unread = toggleSessionListFilter(DEFAULT_SESSION_LIST_FILTER_STATE, 'unread')
        const withActive = toggleSessionListFilter(unread, 'active')
        const withWorking = toggleSessionListFilter(withActive, 'working')
        const withScratch = toggleSessionListFilter(withWorking, 'scratchlist')
        const combined = toggleSessionListFilter(withScratch, 'blocked')

        expect(DEFAULT_SESSION_LIST_FILTER_STATE).toEqual({
            unread: false,
            active: false,
            working: false,
            scratchlist: false,
            blocked: false
        })
        expect(combined).toEqual({
            unread: true,
            active: true,
            working: true,
            scratchlist: true,
            blocked: true
        })
        expect(isSessionListFilterSelected(combined, 'unread')).toBe(true)
        expect(isSessionListFilterSelected(combined, 'active')).toBe(true)
        expect(isSessionListFilterSelected(combined, 'working')).toBe(true)
        expect(isSessionListFilterSelected(combined, 'scratchlist')).toBe(true)
        expect(isSessionListFilterSelected(combined, 'blocked')).toBe(true)
        expect(toggleSessionListFilter(combined, 'unread')).toEqual({
            unread: false,
            active: true,
            working: true,
            scratchlist: true,
            blocked: true
        })
        expect(hasActiveSessionListFilter(DEFAULT_SESSION_LIST_FILTER_STATE)).toBe(false)
        expect(hasActiveSessionListFilter(withActive)).toBe(true)
    })

    it('lists Active and Working after Unread so Date can stay nested under Unread', () => {
        expect(SESSION_LIST_FILTER_OPTIONS.map((option) => option.value)).toEqual([
            'unread',
            'active',
            'working',
            'scratchlist',
            'blocked'
        ])
    })
})
