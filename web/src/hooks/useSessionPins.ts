import { useCallback, useMemo } from 'react'
import type { ApiClient } from '@/api/client'
import { parseSessionLogMessageId } from '@/components/AssistantChat/SessionLogPanel'
import { useSessionSystemEvents } from '@/hooks/queries/useSessionSystemEvents'

/**
 * Thread message ids look like `agent-text:<hubUuid>:0` or `user-text:<hubUuid>`.
 * Pins store the bare hub UUID (same as notify/link_seen payloads).
 */
export function hubMessageIdFromThreadMessageId(threadMessageId: string): string | null {
    const match = /^(?:agent-text|user-text|cli-output|agent-event|agent-reasoning|codex-review):([^:~]+)/.exec(
        threadMessageId
    )
    const id = match?.[1]?.trim()
    return id && id.length > 0 ? id : null
}

export function useSessionPins(api: ApiClient | null, sessionId: string | null) {
    const { events, isLoading, error, refetch } = useSessionSystemEvents(
        api,
        sessionId,
        'operator_pin',
        Boolean(api && sessionId)
    )

    const pinnedIds = useMemo(() => {
        const ids = new Set<string>()
        for (const event of events) {
            const messageId = parseSessionLogMessageId(event.payloadJson)
            if (messageId) ids.add(messageId)
        }
        return ids
    }, [events])

    const isPinned = useCallback((messageId: string) => pinnedIds.has(messageId), [pinnedIds])

    const pin = useCallback(async (input: {
        messageId: string
        summary: string
        targetMessageId?: string
    }) => {
        if (!api || !sessionId) {
            throw new Error('Pin unavailable')
        }
        await api.pinSessionMessage(sessionId, input)
        await refetch()
    }, [api, refetch, sessionId])

    const unpin = useCallback(async (messageId: string) => {
        if (!api || !sessionId) {
            throw new Error('Unpin unavailable')
        }
        await api.unpinSessionMessage(sessionId, messageId)
        await refetch()
    }, [api, refetch, sessionId])

    return {
        pinnedIds,
        isPinned,
        pin,
        unpin,
        isLoading,
        error,
        refetch
    }
}
