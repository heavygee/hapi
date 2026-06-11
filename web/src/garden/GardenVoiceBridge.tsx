import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useVoiceOptional } from '@/lib/voice-context'
import { makeClientSideId } from '@/lib/messages'
import { useSessions } from '@/hooks/queries/useSessions'
import { useSession } from '@/hooks/queries/useSession'
import { useMessages } from '@/hooks/queries/useMessages'
import { VoiceBackendSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { useGardenRuntime } from '@/garden/context/GardenRuntimeContext'
import { filterGardenSessions } from '@/garden/utils/sessionVisuals'
import { applyPersonaOverride } from '@/garden/utils/voicePersona'
import { fetchVoiceBackend } from '@/api/voice'
import type { VoiceBackendType } from '@hapi/protocol/voice'
import type { DecryptedMessage } from '@/types/api'

export function GardenVoiceBridge() {
    const { api } = useAppContext()
    const voice = useVoiceOptional()
    const queryClient = useQueryClient()
    const { focusedId, isPresenting } = useGardenRuntime()
    const { sessions } = useSessions(api)
    const visible = filterGardenSessions(sessions)
    const { session: focusedSession, refetch: refetchSession } = useSession(api, focusedId)
    const { messages: focusedMessages } = useMessages(api, focusedId)
    const [backend, setBackend] = useState<VoiceBackendType | null>(null)

    useEffect(() => {
        if (!api) {
            return
        }
        let cancelled = false
        fetchVoiceBackend(api)
            .then((resp) => {
                if (!cancelled) {
                    setBackend(resp.backend)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBackend(null)
                }
            })
        return () => {
            cancelled = true
        }
    }, [api])

    const startingRef = useRef(false)
    const autoVoiceRef = useRef(false)
    const prevMessagesRef = useRef<DecryptedMessage[]>([])
    const prevThinkingRef = useRef<boolean | undefined>(undefined)
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    const refreshSession = useCallback(async () => {
        await refetchSession()
        if (focusedId) {
            await queryClient.invalidateQueries({ queryKey: ['sessions'] })
        }
    }, [focusedId, queryClient, refetchSession])

    useEffect(() => {
        if (!api || !focusedId || !focusedSession) {
            registerSessionStore(null)
            return
        }

        registerSessionStore({
            getSession: (sessionId: string) => (
                sessionId === focusedId && focusedSession
                    ? focusedSession as { agentState?: { requests?: Record<string, unknown> } }
                    : null
            ),
            sendMessage: (_sessionId: string, message: string) => {
                const localId = makeClientSideId('local')
                void api.sendMessage(focusedId, message, localId)
            },
            approvePermission: async (_sessionId: string, requestId: string) => {
                await api.approvePermission(focusedId, requestId)
                await refreshSession()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await api.denyPermission(focusedId, requestId)
                await refreshSession()
            },
        })
    }, [api, focusedId, focusedSession, refreshSession])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === focusedId && focusedSession ? focusedSession : null),
            (sessionId) => (sessionId === focusedId ? focusedMessages : []),
        )
    }, [focusedId, focusedSession, focusedMessages])

    useEffect(() => {
        if (!focusedId || !focusedSession) {
            prevMessagesRef.current = []
            return
        }

        const prevIds = new Set(prevMessagesRef.current.map((message) => message.id))
        const newMessages = focusedMessages.filter((message) => !prevIds.has(message.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(focusedId, newMessages)
        }

        prevMessagesRef.current = focusedMessages
    }, [focusedId, focusedMessages, focusedSession])

    useEffect(() => {
        if (!focusedId || !focusedSession) {
            prevThinkingRef.current = undefined
            return
        }

        if (prevThinkingRef.current === true && !focusedSession.thinking) {
            voiceHooks.onReady(focusedId)
        }

        prevThinkingRef.current = focusedSession.thinking
    }, [focusedId, focusedSession])

    useEffect(() => {
        if (!focusedId || !focusedSession) {
            prevRequestIdsRef.current = new Set()
            return
        }

        const requests = focusedSession.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    focusedId,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments,
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [focusedId, focusedSession])

    const startVoiceForFocus = useCallback(async (sessionId: string) => {
        if (!voice || startingRef.current) {
            return
        }

        startingRef.current = true
        // Per-orb voice persona: stamp the persona id into the active backend's
        // localStorage key just before startSession reads it. Restore the operator's
        // global pick afterward so flat HAPI behaviour is unchanged.
        const personaOverride = backend
            ? applyPersonaOverride(sessionId, backend)
            : { persona: null, restore: () => {} }
        try {
            const summary = visible.find((session) => session.id === sessionId)
            if (summary) {
                voiceHooks.onSessionFocus(sessionId, summary.metadata ?? undefined)
            }

            if (voice.currentSessionId && voice.currentSessionId !== sessionId) {
                await voice.stopVoice()
            }
            if (voice.currentSessionId !== sessionId) {
                await voice.startVoice(sessionId)
            }
        } catch (error) {
            console.error('[Garden Voice] Failed to start voice:', error)
        } finally {
            personaOverride.restore()
            startingRef.current = false
        }
    }, [voice, visible, backend])

    useEffect(() => {
        if (!voice) {
            return
        }

        if (!focusedId) {
            if (autoVoiceRef.current && voice.currentSessionId) {
                autoVoiceRef.current = false
                void voice.stopVoice()
            }
            return
        }

        if (isPresenting) {
            autoVoiceRef.current = true
            void startVoiceForFocus(focusedId)
            return
        }

        if (autoVoiceRef.current && voice.currentSessionId) {
            autoVoiceRef.current = false
            void voice.stopVoice()
        }
    }, [focusedId, isPresenting, voice, startVoiceForFocus])

    if (!voice) {
        return null
    }

    return (
        <VoiceBackendSession
            api={api}
            micMuted={voice.micMuted}
            onStatusChange={voice.setStatus}
        />
    )
}
