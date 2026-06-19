import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VoiceBackendSession } from './VoiceBackendSession'
import { registerSessionStore } from './realtimeClientTools'
import { registerVoiceHooksStore, voiceHooks } from './hooks/voiceHooks'
import { useAppContext } from '@/lib/app-context'
import { useVoice } from '@/lib/voice-context'
import { getReceivingSessionId, isVoiceTransportActive } from '@/lib/voice-focus'
import { useSession } from '@/hooks/queries/useSession'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSessions } from '@/hooks/queries/useSessions'
import { queryKeys } from '@/lib/query-keys'
import type { DecryptedMessage, Session } from '@/types/api'

/**
 * App-level voice transport that survives session route changes.
 * Bridges receiving-session data into voiceHooks and client tools.
 */
export function VoicePersistenceLayer() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const voice = useVoice()
    const receivingSessionId = getReceivingSessionId(voice.voiceFocus)
    const voiceActive = isVoiceTransportActive(voice.status)

    const { session, refetch: refetchSession } = useSession(api, receivingSessionId)
    const { messages, refetch: refetchMessages } = useMessages(api, receivingSessionId)
    const { sessions, refetch: refetchSessions } = useSessions(api)

    const getSessionForVoice = useCallback((sessionId: string): Session | null => {
        if (sessionId !== receivingSessionId) {
            return null
        }
        if (session) {
            return session
        }
        const cached = queryClient.getQueryData<{ session: Session }>(queryKeys.session(sessionId))
        return cached?.session ?? null
    }, [queryClient, receivingSessionId, session])

    const getMessagesForVoice = useCallback((sessionId: string): DecryptedMessage[] => {
        if (sessionId !== receivingSessionId) {
            return []
        }
        return messages
    }, [messages, receivingSessionId])

    useEffect(() => {
        registerVoiceHooksStore(getSessionForVoice, getMessagesForVoice)
    }, [getSessionForVoice, getMessagesForVoice])

    useEffect(() => {
        registerSessionStore({
            getSession: (sessionId: string) => {
                const sessionData = getSessionForVoice(sessionId)
                return sessionData as { agentState?: { requests?: Record<string, unknown> } } | null
            },
            sendMessage: (sessionId: string, message: string) => {
                void api.sendMessage(sessionId, message).then(() => {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                })
            },
            approvePermission: async (sessionId: string, requestId: string) => {
                await api.approvePermission(sessionId, requestId)
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            },
            denyPermission: async (sessionId: string, requestId: string) => {
                await api.denyPermission(sessionId, requestId)
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            }
        })
    }, [api, getSessionForVoice, queryClient])

    const prevMessagesRef = useRef<DecryptedMessage[]>([])
    useEffect(() => {
        if (!receivingSessionId || !voiceActive) {
            prevMessagesRef.current = []
            return
        }

        const prevIds = new Set(prevMessagesRef.current.map((m) => m.id))
        const newMessages = messages.filter((m) => !prevIds.has(m.id))
        if (newMessages.length > 0) {
            voiceHooks.onMessages(receivingSessionId, newMessages)
        }
        prevMessagesRef.current = messages
    }, [messages, receivingSessionId, voiceActive])

    const prevThinkingRef = useRef<boolean | undefined>(undefined)
    useEffect(() => {
        if (!receivingSessionId || !voiceActive || !session) {
            prevThinkingRef.current = undefined
            return
        }

        if (prevThinkingRef.current && !session.thinking) {
            voiceHooks.onReady(receivingSessionId)
        }
        prevThinkingRef.current = session.thinking
    }, [session?.thinking, receivingSessionId, voiceActive, session])

    const prevRequestIdsRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        if (!receivingSessionId || !voiceActive || !session) {
            prevRequestIdsRef.current = new Set()
            return
        }

        const requests = session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))
        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    receivingSessionId,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }
        prevRequestIdsRef.current = currentIds
    }, [session?.agentState?.requests, receivingSessionId, voiceActive, session])

    useEffect(() => {
        if (!receivingSessionId || !voiceActive) {
            voice.setReceivingSessionDropped(false)
            return
        }

        const summary = sessions.find((s) => s.id === receivingSessionId)
        const dropped = !summary || !summary.active || (session !== null && !session.active)
        voice.setReceivingSessionDropped(dropped)
    }, [receivingSessionId, voiceActive, sessions, session, voice])

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible' || !receivingSessionId || !voiceActive) {
                return
            }
            void refetchSession()
            void refetchMessages()
            void refetchSessions()
        }

        document.addEventListener('visibilitychange', handleVisibility)
        return () => document.removeEventListener('visibilitychange', handleVisibility)
    }, [receivingSessionId, voiceActive, refetchSession, refetchMessages, refetchSessions])

    return (
        <VoiceBackendSession
            api={api}
            micMuted={voice.micMuted}
            onStatusChange={voice.setStatus}
            onReadyChange={voice.setBackendReady}
            getSession={getSessionForVoice}
            sendMessage={(sessionId, message) => {
                void api.sendMessage(sessionId, message)
            }}
            approvePermission={async (sessionId, requestId) => {
                await api.approvePermission(sessionId, requestId)
            }}
            denyPermission={async (sessionId, requestId) => {
                await api.denyPermission(sessionId, requestId)
            }}
        />
    )
}
