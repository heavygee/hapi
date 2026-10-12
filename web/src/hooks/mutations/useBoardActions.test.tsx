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
})
