import { useEffect } from 'react'
import type { DecryptedMessage } from '@/types/api'
import { markGardenSeen } from '@/garden/store/gardenSeenStore'
import { extractLastAssistantMessage } from '@/garden/utils/messageText'

/** Mark a session as seen when the operator views it in flat HAPI chat. */
export function useMarkGardenSeenFromChat(
    sessionId: string,
    updatedAt: number,
    messages: DecryptedMessage[],
    messagesVersion: number,
): void {
    useEffect(() => {
        const assistant = extractLastAssistantMessage(messages)
        markGardenSeen(sessionId, updatedAt, assistant?.id ?? null)
    }, [sessionId, updatedAt, messages, messagesVersion])
}
