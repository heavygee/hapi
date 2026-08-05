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
import { useGardenXrLauncherOptional } from '@/garden/context/GardenXrLauncherContext'
import {
    notifyGardenSessionFocus,
    prefetchGardenVoiceContext,
    primeVoiceHooksForGarden,
} from '@/garden/utils/gardenVoiceContext'
import { filterGardenSessions } from '@/garden/utils/sessionVisuals'
import { applyPersonaOverride } from '@/garden/utils/voicePersona'
import { fetchVoiceBackend } from '@/api/voice'
import { resolveSelectedVoiceBackend } from '@/lib/voicePickerPreferences'
import type { VoiceBackendType } from '@hapi/protocol/voice'
import type { DecryptedMessage } from '@/types/api'

export function GardenVoiceBridge() {
    const { api } = useAppContext()
    const voice = useVoiceOptional()
    const queryClient = useQueryClient()
    const { focusedId, isPresenting } = useGardenRuntime()
    const gardenLauncher = useGardenXrLauncherOptional()
    const overlayOpen = gardenLauncher?.overlayOpen === true
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
                    setBackend(resolveSelectedVoiceBackend(resp.backends, resp.backend))
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
        // Only own the global voice session store while the overlay is up.
        // SessionChat yields on overlayOpen; we must (re)register after that.
        if (!api || !focusedId || !focusedSession || !overlayOpen) {
            return
        }

        registerSessionStore({
            getSession: (sessionId: string) => (
                sessionId === focusedId && focusedSession
                    ? focusedSession as { agentState?: { requests?: Record<string, unknown> } }
                    : null
            ),
            sendMessage: (sessionId: string, message: string) => {
                // Honor realtime session id from client tools — never the flat-UI
                // session that may still be mounted under the overlay.
                if (!focusedId || sessionId !== focusedId) {
                    console.error('[Garden Voice] refusing sendMessage session mismatch', {
                        sessionId,
                        focusedId,
                    })
                    return
                }
                const localId = makeClientSideId('local')
                void api.sendMessage(sessionId, message, localId)
            },
            approvePermission: async (sessionId: string, requestId: string) => {
                if (!focusedId || sessionId !== focusedId) {
                    return
                }
                await api.approvePermission(sessionId, requestId)
                await refreshSession()
            },
            denyPermission: async (sessionId: string, requestId: string) => {
                if (!focusedId || sessionId !== focusedId) {
                    return
                }
                await api.denyPermission(sessionId, requestId)
                await refreshSession()
            },
        })
        return () => {
            registerSessionStore(null)
        }
    }, [api, focusedId, focusedSession, refreshSession, overlayOpen])

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
        if (!voice || !api || startingRef.current) {
            return
        }

        startingRef.current = true
        const personaOverride = backend
            ? applyPersonaOverride(sessionId, backend)
            : { persona: null, restore: () => {} }
        try {
            const prefetch = await prefetchGardenVoiceContext(api, sessionId)
            if (!prefetch) {
                console.warn('[Garden Voice] Session prefetch failed:', sessionId)
                return
            }

            primeVoiceHooksForGarden(prefetch)
            notifyGardenSessionFocus(sessionId, prefetch.session.metadata)

            if (voice.currentSessionId && voice.currentSessionId !== sessionId) {
                await voice.stopVoice()
            }
            if (voice.currentSessionId !== sessionId) {
                await voice.startVoice(sessionId, { proactiveSummary: true })
            }
        } catch (error) {
            console.error('[Garden Voice] Failed to start voice:', error)
        } finally {
            personaOverride.restore()
            startingRef.current = false
        }
    }, [voice, api, backend])

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
