export type SessionListFilter = 'all' | 'unread' | 'scratchlist' | 'blocked'

export type SessionListFilterState = {
    unread: boolean
    scratchlist: boolean
    blocked: boolean
}

export const DEFAULT_SESSION_LIST_FILTER_STATE: SessionListFilterState = {
    unread: false,
    scratchlist: false,
    blocked: false
}

export const SESSION_LIST_FILTER_OPTIONS = [
    { value: 'unread', labelKey: 'sessions.filter.unread' },
    { value: 'scratchlist', labelKey: 'sessions.filter.scratchlist' },
    { value: 'blocked', labelKey: 'sessions.filter.blocked' },
] as const satisfies ReadonlyArray<{ value: Exclude<SessionListFilter, 'all'>; labelKey: string }>

export function isSessionListFilterSelected(
    state: SessionListFilterState,
    filter: Exclude<SessionListFilter, 'all'>
): boolean {
    return state[filter]
}

export function toggleSessionListFilter(
    state: SessionListFilterState,
    filter: Exclude<SessionListFilter, 'all'>
): SessionListFilterState {
    return {
        ...state,
        [filter]: !state[filter]
    }
}

/** Any session-list menu predicate (not date range — that lives outside this state). */
export function hasActiveSessionListFilter(state: SessionListFilterState): boolean {
    return state.unread || state.scratchlist || state.blocked
}
