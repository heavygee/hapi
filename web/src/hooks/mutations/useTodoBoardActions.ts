import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useTodoBoardActions(api: ApiClient | null): {
    addBoard: (url: string) => Promise<void>
    removeBoard: (boardId: string) => Promise<void>
} {
    const queryClient = useQueryClient()

    const addBoard = useCallback(async (url: string) => {
        if (!api) {
            throw new Error('API unavailable')
        }
        const response = await api.addTodoBoard(url)
        queryClient.setQueryData(queryKeys.todoBoards, response)
    }, [api, queryClient])

    const removeBoard = useCallback(async (boardId: string) => {
        if (!api) {
            throw new Error('API unavailable')
        }
        const response = await api.removeTodoBoard(boardId)
        queryClient.setQueryData(queryKeys.todoBoards, response)
        // The removed board's id can be reused (adding the same project URL
        // back produces the same deterministic id) — without evicting this,
        // React Query would briefly serve the pre-removal items for that id
        // from cache before any refetch completes.
        queryClient.removeQueries({ queryKey: queryKeys.todoBoardItems(boardId) })
    }, [api, queryClient])

    return { addBoard, removeBoard }
}
