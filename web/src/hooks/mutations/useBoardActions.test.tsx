import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useBoardActions } from './useBoardActions'
import { queryKeys } from '@/lib/query-keys'
import type { ApiClient } from '@/api/client'
import type { BoardsResponse } from '@/types/api'

function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useBoardActions', () => {
    it('addBoard writes the response straight into the todo-boards cache', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const response: BoardsResponse = { boards: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
        const addBoard = vi.fn().mockResolvedValue(response)
        const api = { addBoard } as unknown as ApiClient

        const { result } = renderHook(() => useBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.addBoard('https://github.com/users/heavygee/projects/6')
        })

        expect(addBoard).toHaveBeenCalledWith('https://github.com/users/heavygee/projects/6')
        expect(queryClient.getQueryData(queryKeys.boards)).toEqual(response)
    })

    it('removeBoard writes the response straight into the todo-boards cache', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const response: BoardsResponse = { boards: [{ id: 'a', label: 'A' }] }
        const removeBoard = vi.fn().mockResolvedValue(response)
        const api = { removeBoard } as unknown as ApiClient

        const { result } = renderHook(() => useBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.removeBoard('b')
        })

        expect(removeBoard).toHaveBeenCalledWith('b')
        expect(queryClient.getQueryData(queryKeys.boards)).toEqual(response)
    })

    it('removeBoard evicts the removed board\'s cached items, not just the board list', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        queryClient.setQueryData(queryKeys.boardItems('b'), { items: [{ id: 'stale-item' }] })
        const response: BoardsResponse = { boards: [{ id: 'a', label: 'A' }] }
        const removeBoard = vi.fn().mockResolvedValue(response)
        const api = { removeBoard } as unknown as ApiClient

        const { result } = renderHook(() => useBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.removeBoard('b')
        })

        expect(queryClient.getQueryData(queryKeys.boardItems('b'))).toBeUndefined()
    })

    it('rejects without touching the api client when api is null', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const { result } = renderHook(() => useBoardActions(null), { wrapper: createWrapper(queryClient) })

        await expect(result.current.addBoard('https://github.com/users/heavygee/projects/6')).rejects.toThrow('API unavailable')
        await expect(result.current.removeBoard('a')).rejects.toThrow('API unavailable')
    })

    it('createBoardItem returns the created url and invalidates that board\'s items cache', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const createBoardItem = vi.fn().mockResolvedValue({ ok: true, url: 'https://github.com/heavygee/hapi/issues/42' })
        const api = { createBoardItem } as unknown as ApiClient

        const { result } = renderHook(() => useBoardActions(api), { wrapper: createWrapper(queryClient) })

        const payload = { repo: 'heavygee/hapi', title: 'New bug', body: 'Broke.', labels: ['bug'], assignees: [] }
        let url: string | undefined
        await act(async () => {
            url = await result.current.createBoardItem('board-1', payload)
        })

        expect(createBoardItem).toHaveBeenCalledWith('board-1', payload)
        expect(url).toBe('https://github.com/heavygee/hapi/issues/42')
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.boardItems('board-1') })
    })

    it('createBoardItem rejects without touching the api client when api is null', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const { result } = renderHook(() => useBoardActions(null), { wrapper: createWrapper(queryClient) })

        await expect(result.current.createBoardItem('board-1', { repo: 'a/b', title: 'T', body: 'B', labels: [], assignees: [] }))
            .rejects.toThrow('API unavailable')
    })
})
