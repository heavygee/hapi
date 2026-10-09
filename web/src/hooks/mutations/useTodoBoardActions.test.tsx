import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTodoBoardActions } from './useTodoBoardActions'
import { queryKeys } from '@/lib/query-keys'
import type { ApiClient } from '@/api/client'
import type { TodoBoardsResponse } from '@/types/api'

function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useTodoBoardActions', () => {
    it('addBoard writes the response straight into the todo-boards cache', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const response: TodoBoardsResponse = { boards: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
        const addTodoBoard = vi.fn().mockResolvedValue(response)
        const api = { addTodoBoard } as unknown as ApiClient

        const { result } = renderHook(() => useTodoBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.addBoard('https://github.com/users/heavygee/projects/6')
        })

        expect(addTodoBoard).toHaveBeenCalledWith('https://github.com/users/heavygee/projects/6')
        expect(queryClient.getQueryData(queryKeys.todoBoards)).toEqual(response)
    })

    it('removeBoard writes the response straight into the todo-boards cache', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const response: TodoBoardsResponse = { boards: [{ id: 'a', label: 'A' }] }
        const removeTodoBoard = vi.fn().mockResolvedValue(response)
        const api = { removeTodoBoard } as unknown as ApiClient

        const { result } = renderHook(() => useTodoBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.removeBoard('b')
        })

        expect(removeTodoBoard).toHaveBeenCalledWith('b')
        expect(queryClient.getQueryData(queryKeys.todoBoards)).toEqual(response)
    })

    it('removeBoard evicts the removed board\'s cached items, not just the board list', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        queryClient.setQueryData(queryKeys.todoBoardItems('b'), { items: [{ id: 'stale-item' }] })
        const response: TodoBoardsResponse = { boards: [{ id: 'a', label: 'A' }] }
        const removeTodoBoard = vi.fn().mockResolvedValue(response)
        const api = { removeTodoBoard } as unknown as ApiClient

        const { result } = renderHook(() => useTodoBoardActions(api), { wrapper: createWrapper(queryClient) })

        await act(async () => {
            await result.current.removeBoard('b')
        })

        expect(queryClient.getQueryData(queryKeys.todoBoardItems('b'))).toBeUndefined()
    })

    it('rejects without touching the api client when api is null', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const { result } = renderHook(() => useTodoBoardActions(null), { wrapper: createWrapper(queryClient) })

        await expect(result.current.addBoard('https://github.com/users/heavygee/projects/6')).rejects.toThrow('API unavailable')
        await expect(result.current.removeBoard('a')).rejects.toThrow('API unavailable')
    })
})
