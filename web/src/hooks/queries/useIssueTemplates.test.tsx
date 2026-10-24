import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useIssueTemplates } from './useIssueTemplates'
import type { ApiClient } from '@/api/client'
import type { GetIssueTemplatesResponse } from '@/types/api'

function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useIssueTemplates', () => {
    it('does not fetch when disabled, even with a repo and boardId set', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getIssueTemplates = vi.fn()
        const api = { getIssueTemplates } as unknown as ApiClient

        renderHook(() => useIssueTemplates(api, 'board-1', 'heavygee/hapi', false), { wrapper: createWrapper(queryClient) })

        expect(getIssueTemplates).not.toHaveBeenCalled()
    })

    it('does not fetch when enabled but repo is null', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getIssueTemplates = vi.fn()
        const api = { getIssueTemplates } as unknown as ApiClient

        renderHook(() => useIssueTemplates(api, 'board-1', null, true), { wrapper: createWrapper(queryClient) })

        expect(getIssueTemplates).not.toHaveBeenCalled()
    })

    it('fetches when enabled with both boardId and repo, and surfaces the response', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const response: GetIssueTemplatesResponse = {
            templates: [{ id: 'bug_report.yml', name: 'Bug report', kind: 'form', fields: [], labels: [], assignees: [] }],
            blankAllowed: true,
            githubNewIssueUrl: 'https://github.com/heavygee/hapi/issues/new/choose'
        }
        const getIssueTemplates = vi.fn().mockResolvedValue(response)
        const api = { getIssueTemplates } as unknown as ApiClient

        const { result } = renderHook(() => useIssueTemplates(api, 'board-1', 'heavygee/hapi', true), { wrapper: createWrapper(queryClient) })

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(getIssueTemplates).toHaveBeenCalledWith('board-1', 'heavygee/hapi')
        expect(result.current.templates).toEqual(response.templates)
        expect(result.current.blankAllowed).toBe(true)
        expect(result.current.githubNewIssueUrl).toBe(response.githubNewIssueUrl)
        expect(result.current.error).toBeNull()
    })

    it('defaults blankAllowed to true and templates to empty before data arrives', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const api = { getIssueTemplates: vi.fn(() => new Promise(() => {})) } as unknown as ApiClient

        const { result } = renderHook(() => useIssueTemplates(api, 'board-1', 'heavygee/hapi', true), { wrapper: createWrapper(queryClient) })

        expect(result.current.templates).toEqual([])
        expect(result.current.blankAllowed).toBe(true)
        expect(result.current.githubNewIssueUrl).toBeNull()
        expect(result.current.isLoading).toBe(true)
    })

    it('surfaces a thrown error message', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const api = { getIssueTemplates: vi.fn().mockRejectedValue(new Error('rate limited')) } as unknown as ApiClient

        const { result } = renderHook(() => useIssueTemplates(api, 'board-1', 'heavygee/hapi', true), { wrapper: createWrapper(queryClient) })

        await waitFor(() => expect(result.current.error).toBe('rate limited'))
    })
})
