import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TodoBoardSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

// Stable reference so consumers' useMemo/useCallback deps don't churn every
// render while the query is loading (a fresh `?? []` allocates a new array
// each time).
const EMPTY_BOARDS: TodoBoardSummary[] = []

export function useTodoBoards(api: ApiClient | null, enabled: boolean): {
    boards: TodoBoardSummary[]
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: queryKeys.todoBoards,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getTodoBoards()
        },
        enabled: Boolean(api && enabled),
    })

    return {
        boards: query.data?.boards ?? EMPTY_BOARDS,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load boards' : null,
    }
}
