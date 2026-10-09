import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TodoBoardItem } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

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
        items: query.data?.items ?? [],
        statusOrder: query.data?.statusOrder ?? [],
        doneValues: query.data?.doneValues ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load board items' : null,
        refetch: query.refetch,
    }
}
