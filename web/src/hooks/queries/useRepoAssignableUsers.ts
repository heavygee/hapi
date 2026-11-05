import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { BoardAssignableUser } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_USERS: BoardAssignableUser[] = []

// Repo-scoped sibling of useBoardAssignableUsers for the "New card" wizard —
// there's no existing item yet to key the fetch off, just the repo the user
// picked. Same lazy-on-open discipline: `enabled` is driven by the assignee
// picker's own popover open state, not board/repo presence alone.
export function useRepoAssignableUsers(
    api: ApiClient | null,
    boardId: string | null,
    repo: string | null,
    enabled: boolean,
    search = ''
): {
    users: BoardAssignableUser[]
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: queryKeys.repoAssignableUsers(boardId ?? '', repo ?? '', search),
        queryFn: async () => {
            if (!api || !boardId || !repo) {
                throw new Error('API unavailable')
            }
            return await api.getRepoAssignableUsers(boardId, repo, search || undefined)
        },
        enabled: Boolean(api && boardId && repo && enabled),
    })

    return {
        users: query.data?.users ?? EMPTY_USERS,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load assignable users' : null,
    }
}
