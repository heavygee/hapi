import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TodoBoardItem } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

/**
 * Close/reopen/comment/status-change for a to-do item — the first
 * write-capable piece of the to-do view (hapi#238). Every action
 * auto-invalidates the board's items query on success (operator requirement:
 * acting from HAPI reflects immediately, no manual refresh needed after a
 * write specifically) and throws on failure, same contract as
 * useTodoBoardActions, leaving toast/dialog-error presentation to the caller.
 *
 * Pending state is tracked as the acting item's *url*, not a bare boolean —
 * one hook instance is shared across the whole board, so a boolean would
 * misattribute an in-flight action on item A as pending for item B the
 * moment the user switches the detail pane to B before A's request settles.
 *
 * Each `finally` only clears the slot if it still holds *that* call's own
 * url (Codex review): starting the same action on item B while item A's is
 * still in flight overwrites the slot to B's url; without this guard,
 * whichever of A/B's request settles first would blindly null the slot even
 * though the other is still running, re-enabling that item's button mid-
 * request and allowing a duplicate submission (e.g. two comments posted).
 * This doesn't let two items show as pending *simultaneously* for the same
 * action — only the most recent one does — but it does guarantee a still-
 * running item is never wrongly shown as idle.
 */
export function useTodoItemActions(api: ApiClient | null, boardId: string | null): {
    closeItem: (item: Pick<TodoBoardItem, 'url'>) => Promise<void>
    reopenItem: (item: Pick<TodoBoardItem, 'url'>) => Promise<void>
    commentOnItem: (item: Pick<TodoBoardItem, 'url'>, body: string) => Promise<void>
    setItemStatus: (item: Pick<TodoBoardItem, 'url'>, status: string) => Promise<void>
    closingUrl: string | null
    reopeningUrl: string | null
    commentingUrl: string | null
    settingStatusUrl: string | null
} {
    const queryClient = useQueryClient()
    const [closingUrl, setClosingUrl] = useState<string | null>(null)
    const [reopeningUrl, setReopeningUrl] = useState<string | null>(null)
    const [commentingUrl, setCommentingUrl] = useState<string | null>(null)
    const [settingStatusUrl, setSettingStatusUrl] = useState<string | null>(null)

    const invalidate = useCallback(() => {
        if (!boardId) return Promise.resolve()
        return queryClient.invalidateQueries({ queryKey: queryKeys.todoBoardItems(boardId) })
    }, [queryClient, boardId])

    const requireTarget = useCallback((url: string | null) => {
        if (!api || !boardId) throw new Error('API unavailable')
        if (!url) throw new Error('This item has no linked issue or pull request to act on')
        return { api, boardId, url }
    }, [api, boardId])

    const closeItem = useCallback(async (item: Pick<TodoBoardItem, 'url'>) => {
        const { api: client, boardId: id, url } = requireTarget(item.url)
        setClosingUrl(url)
        try {
            await client.closeTodoItem(id, url)
            await invalidate()
        } finally {
            setClosingUrl(current => current === url ? null : current)
        }
    }, [requireTarget, invalidate])

    const reopenItem = useCallback(async (item: Pick<TodoBoardItem, 'url'>) => {
        const { api: client, boardId: id, url } = requireTarget(item.url)
        setReopeningUrl(url)
        try {
            await client.reopenTodoItem(id, url)
            await invalidate()
        } finally {
            setReopeningUrl(current => current === url ? null : current)
        }
    }, [requireTarget, invalidate])

    const commentOnItem = useCallback(async (item: Pick<TodoBoardItem, 'url'>, body: string) => {
        const { api: client, boardId: id, url } = requireTarget(item.url)
        setCommentingUrl(url)
        try {
            await client.commentOnTodoItem(id, url, body)
            await invalidate()
        } finally {
            setCommentingUrl(current => current === url ? null : current)
        }
    }, [requireTarget, invalidate])

    const setItemStatus = useCallback(async (item: Pick<TodoBoardItem, 'url'>, status: string) => {
        const { api: client, boardId: id, url } = requireTarget(item.url)
        setSettingStatusUrl(url)
        try {
            await client.setTodoItemStatus(id, url, status)
            await invalidate()
        } finally {
            setSettingStatusUrl(current => current === url ? null : current)
        }
    }, [requireTarget, invalidate])

    return { closeItem, reopenItem, commentOnItem, setItemStatus, closingUrl, reopeningUrl, commentingUrl, settingStatusUrl }
}
