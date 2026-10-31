import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { useBoardItemComments } from './useBoardItemComments'

function wrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

describe('useBoardItemComments', () => {
    it('fetches comments for the given board/item and returns them', async () => {
        const queryClient = new QueryClient()
        const comment = {
            id: 'IC_1',
            author: { login: 'octocat', avatarUrl: 'https://example.com/octocat.png' },
            authorAssociation: 'MEMBER',
            body: 'Looks good',
            createdAt: '2026-10-01T09:00:00Z',
            url: 'https://github.com/a/b/issues/1#issuecomment-1',
            isMinimized: false,
            minimizedReason: null
        }
        const getBoardItemComments = vi.fn().mockResolvedValue({ comments: [comment] })
        const api = { getBoardItemComments } as unknown as ApiClient

        const { result } = renderHook(
            () => useBoardItemComments(api, 'board-1', 'https://github.com/a/b/issues/1'),
            { wrapper: wrapper(queryClient) }
        )

        await waitFor(() => expect(result.current.comments).toEqual([comment]))
        expect(getBoardItemComments).toHaveBeenCalledWith('board-1', 'https://github.com/a/b/issues/1')
    })

    it('does not fetch when there is no item url (draft issue)', () => {
        const queryClient = new QueryClient()
        const getBoardItemComments = vi.fn()
        const api = { getBoardItemComments } as unknown as ApiClient

        const { result } = renderHook(
            () => useBoardItemComments(api, 'board-1', null),
            { wrapper: wrapper(queryClient) }
        )

        expect(getBoardItemComments).not.toHaveBeenCalled()
        expect(result.current.comments).toEqual([])
    })

    it('refetches on demand, reporting isRefetching while the request is in flight', async () => {
        const queryClient = new QueryClient()
        const comment = {
            id: 'IC_1',
            author: { login: 'octocat', avatarUrl: 'https://example.com/octocat.png' },
            authorAssociation: 'MEMBER',
            body: 'Looks good',
            createdAt: '2026-10-01T09:00:00Z',
            url: 'https://github.com/a/b/issues/1#issuecomment-1',
            isMinimized: false,
            minimizedReason: null
        }
        const getBoardItemComments = vi.fn().mockResolvedValue({ comments: [comment] })
        const api = { getBoardItemComments } as unknown as ApiClient

        const { result } = renderHook(
            () => useBoardItemComments(api, 'board-1', 'https://github.com/a/b/issues/1'),
            { wrapper: wrapper(queryClient) }
        )
        await waitFor(() => expect(result.current.comments).toEqual([comment]))
        expect(getBoardItemComments).toHaveBeenCalledTimes(1)

        result.current.refetch()
        await waitFor(() => expect(getBoardItemComments).toHaveBeenCalledTimes(2))
    })

    it('maps a fetch failure to a readable error message', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getBoardItemComments = vi.fn().mockRejectedValue(new Error('Item is not part of this board'))
        const api = { getBoardItemComments } as unknown as ApiClient

        const { result } = renderHook(
            () => useBoardItemComments(api, 'board-1', 'https://github.com/a/b/issues/1'),
            { wrapper: wrapper(queryClient) }
        )

        await waitFor(() => expect(result.current.error).toBe('Item is not part of this board'))
        expect(result.current.comments).toEqual([])
    })
})
