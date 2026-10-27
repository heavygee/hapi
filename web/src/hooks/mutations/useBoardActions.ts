import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CreateBoardItemRequest } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useBoardActions(api: ApiClient | null): {
    addBoard: (url: string) => Promise<void>
    removeBoard: (boardId: string) => Promise<void>
    createBoardItem: (boardId: string, payload: CreateBoardItemRequest) => Promise<string>
} {
    const queryClient = useQueryClient()

    const addBoard = useCallback(async (url: string) => {
        if (!api) {
            throw new Error('API unavailable')
        }
        const response = await api.addBoard(url)
        queryClient.setQueryData(queryKeys.boards, response)
    }, [api, queryClient])

    const removeBoard = useCallback(async (boardId: string) => {
        if (!api) {
            throw new Error('API unavailable')
        }
        const response = await api.removeBoard(boardId)
        queryClient.setQueryData(queryKeys.boards, response)
        // The removed board's id can be reused (adding the same project URL
        // back produces the same deterministic id) — without evicting this,
        // React Query would briefly serve the pre-removal items for that id
        // from cache before any refetch completes.
        queryClient.removeQueries({ queryKey: queryKeys.boardItems(boardId) })
    }, [api, queryClient])

    // Dialog-owned flow (same contract as addBoard — throws on failure,
    // leaves error presentation to the caller's dialog state), not the
    // always-available fire-and-toast pattern useBoardItemActions uses for
    // existing-item actions: this is a one-shot, blocking "create" action
    // reviewed before submission, not a background mutation on an item
    // already on the board.
    const createBoardItem = useCallback(async (boardId: string, payload: CreateBoardItemRequest) => {
        if (!api) {
            throw new Error('API unavailable')
        }
        const response = await api.createBoardItem(boardId, payload)
        await queryClient.invalidateQueries({ queryKey: queryKeys.boardItems(boardId) })
        return response.url
    }, [api, queryClient])

    return { addBoard, removeBoard, createBoardItem }
}
