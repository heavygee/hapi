import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ConversationStatus, StatusCallback } from '@/realtime/types'
import { startRealtimeSession, stopRealtimeSession, voiceHooks } from '@/realtime'
import { storeVoiceContextNotice } from '@/lib/voiceContextStream'
import { getElevenLabsCodeFromPreference } from '@/lib/languages'
import { readStoredVoiceSelection } from '@/lib/voicePickerPreferences'
import type { VoiceFocus } from '@hapi/protocol/voice'

interface VoiceContextValue {
    status: ConversationStatus
    errorMessage: string | null
    micMuted: boolean
    /** @deprecated Prefer voiceFocus.ref when kind is 'session'. */
    currentSessionId: string | null
    voiceFocus: VoiceFocus | null
    backendReady: boolean
    receivingSessionDropped: boolean
    setStatus: (status: ConversationStatus, errorMessage?: string) => void
    setMicMuted: (muted: boolean) => void
    setBackendReady: (ready: boolean) => void
    setReceivingSessionDropped: (dropped: boolean) => void
    toggleMic: () => void
    startVoice: (sessionId: string) => Promise<void>
    stopVoice: () => Promise<void>
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function VoiceProvider({ children }: { children: ReactNode }) {
    const [status, setStatusInternal] = useState<ConversationStatus>('disconnected')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [micMuted, setMicMuted] = useState(false)
    const [voiceFocus, setVoiceFocus] = useState<VoiceFocus | null>(null)
    const [backendReady, setBackendReady] = useState(false)
    const [receivingSessionDropped, setReceivingSessionDropped] = useState(false)

    const currentSessionId = voiceFocus?.kind === 'session' ? (voiceFocus.ref ?? null) : null

    const setStatus: StatusCallback = useCallback((newStatus, error) => {
        setStatusInternal(newStatus)
        if (newStatus === 'error') {
            setErrorMessage(error ?? null)
        } else if (newStatus === 'connected') {
            setErrorMessage(null)
        }
    }, [])

    const toggleMic = useCallback(() => {
        setMicMuted((prev) => !prev)
    }, [])

    const startVoice = useCallback(async (sessionId: string) => {
        if (status === 'connected' || status === 'connecting') {
            voiceHooks.onVoiceStopped()
            await stopRealtimeSession()
        }
        setReceivingSessionDropped(false)
        setVoiceFocus({ kind: 'session', ref: sessionId })
        const contextPlan = voiceHooks.prepareVoiceSession(sessionId)
        storeVoiceContextNotice(contextPlan.notice)

        const voiceLang = localStorage.getItem('hapi-voice-lang')
        const elevenLabsLang = getElevenLabsCodeFromPreference(voiceLang)
        const voiceId = readStoredVoiceSelection('elevenlabs') ?? undefined

        await startRealtimeSession(sessionId, {
            bootstrap: contextPlan.bootstrap,
            streamChunks: contextPlan.streamChunks,
            notice: contextPlan.notice
        }, elevenLabsLang, voiceId)
    }, [status])

    const stopVoice = useCallback(async () => {
        voiceHooks.onVoiceStopped()
        await stopRealtimeSession()
        setVoiceFocus(null)
        setReceivingSessionDropped(false)
        setStatusInternal('disconnected')
        setErrorMessage(null)
    }, [])

    return (
        <VoiceContext.Provider
            value={{
                status,
                errorMessage,
                micMuted,
                currentSessionId,
                voiceFocus,
                backendReady,
                receivingSessionDropped,
                setStatus,
                setMicMuted,
                setBackendReady,
                setReceivingSessionDropped,
                toggleMic,
                startVoice,
                stopVoice
            }}
        >
            {children}
        </VoiceContext.Provider>
    )
}

export function useVoice(): VoiceContextValue {
    const context = useContext(VoiceContext)
    if (!context) {
        throw new Error('useVoice must be used within a VoiceProvider')
    }
    return context
}

export function useVoiceOptional(): VoiceContextValue | null {
    return useContext(VoiceContext)
}
