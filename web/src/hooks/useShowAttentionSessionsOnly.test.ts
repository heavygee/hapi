import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY,
    getInitialShowAttentionSessionsOnly,
    useShowAttentionSessionsOnly,
} from '@/hooks/useShowAttentionSessionsOnly'

const STORAGE_KEY = 'hapi-show-attention-sessions-only'

describe('useShowAttentionSessionsOnly helpers', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to off when nothing is stored', () => {
        expect(getInitialShowAttentionSessionsOnly()).toBe(DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY)
        expect(DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY).toBe(false)
    })

    it('reads a stored "true" as on', () => {
        window.localStorage.setItem(STORAGE_KEY, 'true')
        expect(getInitialShowAttentionSessionsOnly()).toBe(true)
    })

    it('treats any non-"true" stored value as off', () => {
        window.localStorage.setItem(STORAGE_KEY, 'garbage')
        expect(getInitialShowAttentionSessionsOnly()).toBe(false)
    })
})

describe('useShowAttentionSessionsOnly', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('starts off by default', () => {
        const { result } = renderHook(() => useShowAttentionSessionsOnly())
        expect(result.current.showAttentionSessionsOnly).toBe(false)
    })

    it('turning on writes true to localStorage and updates state', () => {
        const { result } = renderHook(() => useShowAttentionSessionsOnly())

        act(() => {
            result.current.setShowAttentionSessionsOnly(true)
        })

        expect(result.current.showAttentionSessionsOnly).toBe(true)
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
    })

    it('turning off removes the localStorage key and updates state', () => {
        window.localStorage.setItem(STORAGE_KEY, 'true')
        const { result } = renderHook(() => useShowAttentionSessionsOnly())
        expect(result.current.showAttentionSessionsOnly).toBe(true)

        act(() => {
            result.current.setShowAttentionSessionsOnly(false)
        })

        expect(result.current.showAttentionSessionsOnly).toBe(false)
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('syncs across instances via the storage event', () => {
        const { result } = renderHook(() => useShowAttentionSessionsOnly())
        expect(result.current.showAttentionSessionsOnly).toBe(false)

        act(() => {
            window.localStorage.setItem(STORAGE_KEY, 'true')
            window.dispatchEvent(new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: 'true',
            }))
        })

        expect(result.current.showAttentionSessionsOnly).toBe(true)
    })
})
