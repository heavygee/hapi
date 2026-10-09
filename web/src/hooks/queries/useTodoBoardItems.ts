import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TodoBoardItem } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

// Stable references so consumers' useMemo/useCallback deps don't churn every
// render while the query is loading (a fresh `?? []` allocates a new array
// each time).
const EMPTY_ITEMS: TodoBoardItem[] = []
const EMPTY_STRINGS: string[] = []

export function useTodoBoardItems(api: ApiClient | null, boardId: string | null): {
    items: TodoBoardItem[]
    statusOrder: string[]
    doneValues: string[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.todoBoardItems(boardId ?? ''),
        queryFn: async () => {
            if (!api || !boardId) {
                throw new Error('API unavailable')
            }
            return await api.getTodoBoardItems(boardId)
        },
        enabled: Boolean(api && boardId),
    })

    return {
        items: query.data?.items ?? EMPTY_ITEMS,
        statusOrder: query.data?.statusOrder ?? EMPTY_STRINGS,
        doneValues: query.data?.doneValues ?? EMPTY_STRINGS,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load board items' : null,
        refetch: query.refetch,
    }
}
