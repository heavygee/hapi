import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { IssueTemplate } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_TEMPLATES: IssueTemplate[] = []

// `enabled` is driven by the caller (the "New card" dialog's own open state
// and repo-selection step), not just api/boardId/repo presence — fetching
// every configured repo's templates eagerly would mean a GraphQL call for
// data nobody may ever open the dialog to see.
//
// Always a live fetch, standard React Query staleTime defaults — no
// persistent cache across dialog opens (operator decision, hapi#238: a
// silently-stale issue-templates form is worse than one extra `gh api
// graphql` round trip). Memoization is purely incidental: picking between
// already-fetched repos within one open dialog reuses this same query
// instead of re-fetching, but reopening the dialog (or React Query's own
// garbage collection evicting the cache entry) always refetches live.
export function useIssueTemplates(
    api: ApiClient | null,
    boardId: string | null,
    repo: string | null,
    enabled: boolean
): {
    templates: IssueTemplate[]
    blankAllowed: boolean
    githubNewIssueUrl: string | null
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: queryKeys.issueTemplates(boardId ?? '', repo ?? ''),
        queryFn: async () => {
            if (!api || !boardId || !repo) {
                throw new Error('API unavailable')
            }
            return await api.getIssueTemplates(boardId, repo)
        },
        enabled: Boolean(api && boardId && repo && enabled),
    })

    return {
        templates: query.data?.templates ?? EMPTY_TEMPLATES,
        blankAllowed: query.data?.blankAllowed ?? true,
        githubNewIssueUrl: query.data?.githubNewIssueUrl ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load issue templates' : null,
    }
}
