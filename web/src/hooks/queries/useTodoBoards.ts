import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TodoBoardSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

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
        boards: query.data?.boards ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load boards' : null,
    }
}
