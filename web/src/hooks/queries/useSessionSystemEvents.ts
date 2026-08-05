import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { SystemEventsResponse } from '@/types/systemEvents'

const SESSION_EVENTS_STALE_TIME_MS = 5_000
const SESSION_EVENTS_PAGE_SIZE = 100

export function useSessionSystemEvents(
    api: ApiClient | null,
    sessionId: string | null,
    eventType: string | null = null,
    enabled = true
): {
    events: SystemEventsResponse['events']
    total: number
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const filterKey = eventType ?? 'all'
    const query = useQuery({
        queryKey: queryKeys.sessionSystemEvents(resolvedSessionId, filterKey),
        queryFn: async (): Promise<SystemEventsResponse> => {
            if (!api || !sessionId) {
                throw new Error('Session events unavailable')
            }
            return await api.fetchSystemEvents({
                sessionId,
                limit: SESSION_EVENTS_PAGE_SIZE,
                eventType: eventType ?? undefined
            }) as SystemEventsResponse
        },
        enabled: Boolean(api && sessionId && enabled),
        staleTime: SESSION_EVENTS_STALE_TIME_MS
    })

    return {
        events: query.data?.events ?? [],
        total: query.data?.total ?? 0,
        isLoading: query.isLoading || query.isFetching,
        error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
        refetch: query.refetch
    }
}

export { SESSION_EVENTS_PAGE_SIZE }
