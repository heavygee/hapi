import { useEffect, useRef, useCallback, useState } from 'react'
import { useConversation } from '@elevenlabs/react'
import { registerVoiceSession, resetRealtimeSessionState } from './RealtimeSession'
import { realtimeClientTools, registerSessionStore } from './realtimeClientTools'
import { fetchVoiceToken } from '@/api/voice'
import type { VoiceSession, VoiceSessionConfig, ConversationStatus, StatusCallback } from './types'
import type { ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { DEFAULT_VOICE_ID } from '@/lib/voices'

// Debug logging
const DEBUG = import.meta.env.DEV

// Static reference to the conversation hook instance
let conversationInstance: ReturnType<typeof useConversation> | null = null

// Store reference for status updates
let statusCallback: StatusCallback | null = null
let telemetryApi: ApiClient | null = null
let activeVoiceContext: {
    sessionId?: string
    voiceId?: string
    language?: string
} = {}

async function emitVoiceTelemetry(event: {
    stage: string
    message: string
    sessionId?: string
    voiceId?: string
    language?: string
    details?: Record<string, unknown>
}): Promise<void> {
    if (!telemetryApi) return
    try {
        await telemetryApi.sendVoiceTelemetry(event)
    } catch {
        // Telemetry must not break voice flows
    }
}

// Global voice session implementation
class RealtimeVoiceSessionImpl implements VoiceSession {
    private api: ApiClient

    constructor(api: ApiClient) {
        this.api = api
    }

    private async sendTelemetry(event: {
        stage: string
        message: string
        sessionId?: string
        voiceId?: string
        language?: string
        details?: Record<string, unknown>
    }): Promise<void> {
        await emitVoiceTelemetry(event)
    }

    async startSession(config: VoiceSessionConfig): Promise<void> {
        activeVoiceContext = {
            sessionId: config.sessionId,
            voiceId: config.voiceId,
            language: config.language
        }
        await this.sendTelemetry({
            stage: 'start-session',
            message: 'Voice start requested',
            sessionId: config.sessionId,
            voiceId: config.voiceId,
            language: config.language
        })

        if (!conversationInstance) {
            const error = new Error('Realtime voice session not initialized')
            console.warn('[Voice] Realtime voice session not initialized')
            await this.sendTelemetry({
                stage: 'init-missing',
                message: error.message,
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language
            })
            statusCallback?.('error', 'Voice session not initialized')
            throw error
        }

        statusCallback?.('connecting')

        // Request microphone permission first
        let permissionStream: MediaStream | null = null
        try {
            permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (error) {
            console.error('[Voice] Failed to get microphone permission:', error)
            await this.sendTelemetry({
                stage: 'mic-permission-denied',
                message: error instanceof Error ? error.message : String(error),
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language
            })
            statusCallback?.('error', 'Microphone permission denied')
            throw error
        } finally {
            permissionStream?.getTracks().forEach((track) => track.stop())
        }

        // Fetch conversation token from server
        let tokenResponse: Awaited<ReturnType<typeof fetchVoiceToken>>
        try {
            tokenResponse = await fetchVoiceToken(this.api, {
                voiceId: config.voiceId
            })
        } catch (error) {
            console.error('[Voice] Failed to fetch voice token:', error)
            await this.sendTelemetry({
                stage: 'token-fetch-error',
                message: error instanceof Error ? error.message : String(error),
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language
            })
            statusCallback?.('error', 'Network error')
            throw error
        }
        if (!tokenResponse.allowed || !tokenResponse.token) {
            const error = new Error(tokenResponse.error ?? 'Voice not allowed or no token')
            console.error('[Voice] Voice not allowed or no token:', tokenResponse.error)
            await this.sendTelemetry({
                stage: 'token-not-allowed',
                message: tokenResponse.error ?? 'Voice not allowed',
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language,
                details: {
                    agentId: tokenResponse.agentId
                }
            })
            statusCallback?.('error', tokenResponse.error ?? 'Voice not allowed')
            throw error
        }

        const baseSessionConfig = {
            conversationToken: tokenResponse.token,
            connectionType: 'webrtc' as const,
            dynamicVariables: {
                sessionId: config.sessionId,
                initialConversationContext: config.initialContext || ''
            },
            // Language override — requires override permissions enabled on the agent
            // See: https://elevenlabs.io/docs/agents-platform/customization/personalization/overrides
            overrides: {
                agent: {
                    language: config.language
                }
            }
        }

        await this.sendTelemetry({
            stage: 'override-decision',
            message: 'Skipping runtime voice override; using token-selected agent voice',
            sessionId: config.sessionId,
            voiceId: config.voiceId,
            language: config.language,
            details: {
                defaultVoiceId: DEFAULT_VOICE_ID,
                selectedVoiceId: config.voiceId
            }
        })

        // Use conversation token from server (private agent flow)
        try {
            const conversationId = await conversationInstance.startSession(baseSessionConfig)

            if (DEBUG) {
                console.log('[Voice] Started conversation with ID:', conversationId)
            }
            await this.sendTelemetry({
                stage: 'start-success',
                message: 'Voice session started successfully',
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error('[Voice] Failed to start realtime session:', {
                error: errorMessage,
                sessionId: config.sessionId,
                language: config.language,
                voiceId: config.voiceId
            })
            await this.sendTelemetry({
                stage: 'start-failed',
                message: errorMessage,
                sessionId: config.sessionId,
                voiceId: config.voiceId,
                language: config.language
            })
            statusCallback?.('error', `Failed to start voice session: ${errorMessage}`)
            throw error
        }
    }

    async endSession(): Promise<void> {
        if (!conversationInstance) {
            return
        }

        try {
            await conversationInstance.endSession()
            statusCallback?.('disconnected')
        } catch (error) {
            console.error('[Voice] Failed to end realtime session:', error)
        }
    }

    sendTextMessage(message: string): void {
        if (!conversationInstance) {
            console.warn('[Voice] Realtime voice session not initialized')
            return
        }

        conversationInstance.sendUserMessage(message)
    }

    sendContextualUpdate(update: string): void {
        if (!conversationInstance) {
            console.warn('[Voice] Realtime voice session not initialized')
            return
        }

        conversationInstance.sendContextualUpdate(update)
    }
}

export interface RealtimeVoiceSessionProps {
    api: ApiClient
    micMuted?: boolean
    onStatusChange?: StatusCallback
    getSession?: (sessionId: string) => Session | null
    sendMessage?: (sessionId: string, message: string) => void
    approvePermission?: (sessionId: string, requestId: string) => Promise<void>
    denyPermission?: (sessionId: string, requestId: string) => Promise<void>
}

export function RealtimeVoiceSession({
    api,
    micMuted: micMutedProp = false,
    onStatusChange,
    getSession,
    sendMessage,
    approvePermission,
    denyPermission
}: RealtimeVoiceSessionProps) {
    const hasRegistered = useRef(false)

    // Use local state for micMuted that syncs with prop
    // This is recommended by ElevenLabs SDK docs
    const [micMuted, setMicMuted] = useState(micMutedProp)

    // Sync local state with prop changes
    useEffect(() => {
        setMicMuted(micMutedProp)
    }, [micMutedProp])

    // Store status callback
    useEffect(() => {
        statusCallback = onStatusChange || null
        return () => {
            statusCallback = null
        }
    }, [onStatusChange])

    // Register session store for client tools
    useEffect(() => {
        if (getSession && sendMessage && approvePermission && denyPermission) {
            registerSessionStore({
                getSession: (sessionId: string) => getSession(sessionId) as { agentState?: { requests?: Record<string, unknown> } } | null,
                sendMessage,
                approvePermission,
                denyPermission
            })
        }
    }, [getSession, sendMessage, approvePermission, denyPermission])

    const handleConnect = useCallback(() => {
        if (DEBUG) console.log('[Voice] Realtime session connected')
        onStatusChange?.('connected')
    }, [onStatusChange])

    const handleDisconnect = useCallback(() => {
        if (DEBUG) console.log('[Voice] Realtime session disconnected')
        resetRealtimeSessionState()
        void emitVoiceTelemetry({
            stage: 'disconnect',
            message: 'Realtime voice session disconnected',
            ...activeVoiceContext
        })
        onStatusChange?.('disconnected')
    }, [onStatusChange])

    const handleError = useCallback((error: unknown) => {
        if (DEBUG) console.error('[Voice] Realtime error:', error)
        const errorMessage = error instanceof Error
            ? error.message
            : (() => {
                try {
                    return JSON.stringify(error)
                } catch {
                    return String(error ?? 'Connection error')
                }
            })()
        void emitVoiceTelemetry({
            stage: 'runtime-error',
            message: errorMessage,
            ...activeVoiceContext
        })
        onStatusChange?.('error', errorMessage)
    }, [onStatusChange])

    const handleMessage = useCallback((data: unknown) => {
        if (DEBUG) console.log('[Voice] Realtime message:', data)
    }, [])

    const handleStatusChange = useCallback((data: unknown) => {
        if (DEBUG) console.log('[Voice] Realtime status change:', data)
    }, [])

    const handleModeChange = useCallback((data: unknown) => {
        if (DEBUG) console.log('[Voice] Realtime mode change:', data)
    }, [])

    const handleDebug = useCallback((message: unknown) => {
        if (DEBUG) console.debug('[Voice] Realtime debug:', message)
    }, [])

    // Debug: log when micMuted changes
    useEffect(() => {
        if (DEBUG) console.log('[Voice] micMuted changed to:', micMuted)
    }, [micMuted])

    const conversation = useConversation({
        clientTools: realtimeClientTools,
        micMuted,
        onConnect: handleConnect,
        onDisconnect: handleDisconnect,
        onMessage: handleMessage,
        onError: handleError,
        onStatusChange: handleStatusChange,
        onModeChange: handleModeChange,
        onDebug: handleDebug
    })

    useEffect(() => {
        telemetryApi = api
        // Store the conversation instance globally
        conversationInstance = conversation

        // Register the voice session once
        if (!hasRegistered.current) {
            try {
                registerVoiceSession(new RealtimeVoiceSessionImpl(api))
                hasRegistered.current = true
            } catch (error) {
                console.error('[Voice] Failed to register voice session:', error)
            }
        }

        return () => {
            // Clean up on unmount
            conversationInstance = null
            telemetryApi = null
        }
    }, [conversation, api])

    // This component doesn't render anything visible
    return null
}
