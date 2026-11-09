import { useCallback } from 'react'
import { useSessionListView } from './useSessionListView'

export const DEFAULT_SHOW_ACTIVE_SESSIONS_ONLY = false

/**
 * Thin derived view over the shared session-list-view store's `status`
 * field. Kept as a separate boolean-shaped hook so existing callers (the
 * Settings page) are unaffected, but it is the SAME store as the combined
 * filter menu — toggling either one updates the other immediately.
 */
export function useShowActiveSessionsOnly(): {
    showActiveSessionsOnly: boolean
    setShowActiveSessionsOnly: (value: boolean) => void
} {
    const { view, setView } = useSessionListView()
    const setShowActiveSessionsOnly = useCallback((value: boolean) => {
        setView({ status: value ? 'active' : 'all' })
    }, [setView])

    return { showActiveSessionsOnly: view.status === 'active', setShowActiveSessionsOnly }
}
