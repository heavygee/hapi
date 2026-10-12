import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { useTodoItemActions } from './useTodoItemActions'

function wrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

describe('useTodoItemActions', () => {
    it('closes an item and invalidates the board items query on success', async () => {
        const queryClient = new QueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const closeTodoItem = vi.fn().mockResolvedValue(undefined)
        const api = { closeTodoItem } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })
        await result.current.closeItem({ url: 'https://github.com/a/b/issues/1' })

        expect(closeTodoItem).toHaveBeenCalledWith('board-1', 'https://github.com/a/b/issues/1')
        expect(invalidateSpy).toHaveBeenCalled()
    })

    it('tracks closingUrl across the call, scoped to the acting item', async () => {
        const queryClient = new QueryClient()
        let resolveClose: () => void = () => {}
        const closeTodoItem = vi.fn(() => new Promise<void>((resolve) => { resolveClose = resolve }))
        const api = { closeTodoItem } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })
        expect(result.current.closingUrl).toBeNull()

        const promise = result.current.closeItem({ url: 'https://github.com/a/b/issues/1' })
        await waitFor(() => expect(result.current.closingUrl).toBe('https://github.com/a/b/issues/1'))

        resolveClose()
        await promise
        await waitFor(() => expect(result.current.closingUrl).toBeNull())
    })

    it('does not clear closingUrl for a still-running item when an earlier one on a different item settles first (Codex review)', async () => {
        const queryClient = new QueryClient()
        let resolveA: () => void = () => {}
        let resolveB: () => void = () => {}
        let callCount = 0
        const closeTodoItem = vi.fn(() => new Promise<void>((resolve) => {
            callCount += 1
            if (callCount === 1) resolveA = resolve
            else resolveB = resolve
        }))
        const api = { closeTodoItem } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })

        const promiseA = result.current.closeItem({ url: 'https://github.com/a/b/issues/1' })
        await waitFor(() => expect(result.current.closingUrl).toBe('https://github.com/a/b/issues/1'))

        const promiseB = result.current.closeItem({ url: 'https://github.com/a/b/issues/2' })
        await waitFor(() => expect(result.current.closingUrl).toBe('https://github.com/a/b/issues/2'))

        // Item A's request settles first, but item B's is still in flight —
        // the slot must keep pointing at B, not clear to null (which would
        // wrongly re-enable B's button mid-request).
        resolveA()
        await promiseA
        await waitFor(() => expect(result.current.closingUrl).toBe('https://github.com/a/b/issues/2'))

        resolveB()
        await promiseB
        await waitFor(() => expect(result.current.closingUrl).toBeNull())
    })

    it('rejects without calling the API when the item has no url (draft issue)', async () => {
        const queryClient = new QueryClient()
        const closeTodoItem = vi.fn()
        const api = { closeTodoItem } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })
        await expect(result.current.closeItem({ url: null })).rejects.toThrow()
        expect(closeTodoItem).not.toHaveBeenCalled()
    })

    it('rejects without calling the API when there is no board selected', async () => {
        const queryClient = new QueryClient()
        const setTodoItemStatus = vi.fn()
        const api = { setTodoItemStatus } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, null), { wrapper: wrapper(queryClient) })
        await expect(result.current.setItemStatus({ url: 'https://github.com/a/b/issues/1' }, 'Done')).rejects.toThrow()
        expect(setTodoItemStatus).not.toHaveBeenCalled()
    })

    it('propagates a failed write without invalidating the query', async () => {
        const queryClient = new QueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const commentOnTodoItem = vi.fn().mockRejectedValue(new Error('gh issue comment failed'))
        const api = { commentOnTodoItem } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })
        await expect(result.current.commentOnItem({ url: 'https://github.com/a/b/issues/1' }, 'hi')).rejects.toThrow('gh issue comment failed')
        expect(invalidateSpy).not.toHaveBeenCalled()
    })

    it('sets status via the API, resolving the board id and item url', async () => {
        const queryClient = new QueryClient()
        const setTodoItemStatus = vi.fn().mockResolvedValue(undefined)
        const api = { setTodoItemStatus } as unknown as ApiClient

        const { result } = renderHook(() => useTodoItemActions(api, 'board-1'), { wrapper: wrapper(queryClient) })
        await result.current.setItemStatus({ url: 'https://github.com/a/b/issues/1' }, 'Done')

        expect(setTodoItemStatus).toHaveBeenCalledWith('board-1', 'https://github.com/a/b/issues/1', 'Done')
    })
})
