import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useVoiceOptional } from '@/lib/voice-context'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useGardenRuntime } from '@/garden/context/GardenRuntimeContext'
import { filterGardenSessions, sessionLabel } from '@/garden/utils/sessionVisuals'
import { fetchVoiceBackend } from '@/api/voice'
import { voicePersonaForSession } from '@/garden/utils/voicePersona'
import type { VoiceBackendType } from '@hapi/protocol/voice'

const STATUS_LABEL: Record<string, string> = {
    disconnected: 'off',
    connecting: 'connecting…',
    connected: 'listening',
    error: 'error',
}

const BACKEND_LABEL: Record<VoiceBackendType, string> = {
    elevenlabs: 'ElevenLabs',
    'gemini-live': 'Gemini',
    'qwen-realtime': 'Qwen',
}

export function GardenVoiceHud() {
    const { api } = useAppContext()
    const voice = useVoiceOptional()
    const { focusedId, isPresenting } = useGardenRuntime()
    const { sessions } = useSessions(api)
    const visible = filterGardenSessions(sessions)
    const { session: focusedSession } = useSession(api, focusedId)
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

    const focusedSummary = useMemo(
        () => visible.find((session) => session.id === focusedId) ?? null,
        [visible, focusedId],
    )

    const pendingRequestId = useMemo(() => {
        const requests = focusedSession?.agentState?.requests ?? {}
        const ids = Object.keys(requests)
        return ids.length > 0 ? ids[0] : null
    }, [focusedSession?.agentState?.requests])

    if (!voice) {
        return null
    }

    const statusLabel = STATUS_LABEL[voice.status] ?? voice.status
    const focusedLabel = focusedSummary ? sessionLabel(focusedSummary) : null
    const backendLabel = backend ? BACKEND_LABEL[backend] : null
    const personaLabel = useMemo(
        () => (focusedId && backend ? voicePersonaForSession(focusedId, backend)?.label ?? null : null),
        [focusedId, backend],
    )

    const showManualConnect = Boolean(
        focusedId && !isPresenting && voice.status === 'disconnected'
    )

    const handleApprove = () => {
        if (!focusedId || !pendingRequestId || !api) {
            return
        }
        void api.approvePermission(focusedId, pendingRequestId)
    }

    const handleDeny = () => {
        if (!focusedId || !pendingRequestId || !api) {
            return
        }
        void api.denyPermission(focusedId, pendingRequestId)
    }

    return (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-slate-700 bg-black/85 px-3 py-2 font-mono text-xs text-slate-200 shadow-lg">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                            voice.status === 'connected'
                                ? 'bg-emerald-400 animate-pulse'
                                : voice.status === 'connecting'
                                    ? 'bg-amber-400 animate-pulse'
                                    : voice.status === 'error'
                                        ? 'bg-red-500'
                                        : 'bg-slate-500'
                        }`}
                        aria-hidden
                    />
                    <span className="truncate">
                        voice {statusLabel}
                        {backendLabel ? ` · ${backendLabel}` : ''}
                        {personaLabel ? ` · ${personaLabel}` : ''}
                        {focusedLabel ? ` · ${focusedLabel}` : focusedId ? '' : ' · gaze an orb'}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {showManualConnect && (
                        <button
                            type="button"
                            className="rounded border border-sky-700 px-2 py-1 text-sky-200 hover:bg-sky-950"
                            onClick={() => void voice.startVoice(focusedId!)}
                        >
                            Connect
                        </button>
                    )}
                    {(voice.status === 'connected' || voice.status === 'connecting') && (
                        <button
                            type="button"
                            className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-900"
                            onClick={() => void voice.stopVoice()}
                        >
                            Stop
                        </button>
                    )}
                    <button
                        type="button"
                        className={`rounded border px-2 py-1 ${
                            voice.micMuted
                                ? 'border-amber-700 text-amber-200'
                                : 'border-slate-600 hover:bg-slate-900'
                        }`}
                        onClick={voice.toggleMic}
                        disabled={voice.status !== 'connected'}
                    >
                        {voice.micMuted ? 'Unmute' : 'Mute'}
                    </button>
                </div>
            </div>

            {voice.errorMessage && (
                <div className="mt-1 text-red-300 truncate">{voice.errorMessage}</div>
            )}

            {pendingRequestId && focusedId && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
                    <span className="text-amber-300 truncate">Permission waiting</span>
                    <div className="flex gap-1 shrink-0">
                        <button
                            type="button"
                            className="rounded border border-emerald-700 px-2 py-1 text-emerald-200 hover:bg-emerald-950"
                            onClick={handleApprove}
                        >
                            Allow
                        </button>
                        <button
                            type="button"
                            className="rounded border border-red-800 px-2 py-1 text-red-200 hover:bg-red-950"
                            onClick={handleDeny}
                        >
                            Deny
                        </button>
                    </div>
                </div>
            )}

            {isPresenting && (
                <div className="mt-1 text-slate-500">
                    VR: dwell an orb to focus · voice stays until you dwell another
                </div>
            )}
        </div>
    )
}
