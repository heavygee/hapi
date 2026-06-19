import { useNavigate } from '@tanstack/react-router'
import { useVoice } from '@/lib/voice-context'
import { useSessions } from '@/hooks/queries/useSessions'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import {
    getReceivingSessionId,
    isSessionVoiceFocus,
    isVoiceTransportActive,
    resolveVoiceFocusLabel,
} from '@/lib/voice-focus'
import { VoiceReceivingIcon } from '@/components/VoiceReceivingIcon'

export function VoiceFocusPill() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { api } = useAppContext()
    const voice = useVoice()
    const { sessions } = useSessions(api)

    if (!isSessionVoiceFocus(voice.voiceFocus) || !isVoiceTransportActive(voice.status)) {
        return null
    }

    const sessionId = getReceivingSessionId(voice.voiceFocus)
    const label = resolveVoiceFocusLabel(voice.voiceFocus, sessions, sessionId)

    return (
        <div
            data-testid="voice-focus-pill"
            className="fixed left-1/2 top-2 z-50 flex max-w-[min(92vw,28rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--app-link)]/40 bg-[var(--app-secondary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--app-fg)] shadow-lg"
            role="status"
            aria-live="polite"
        >
            <VoiceReceivingIcon className="h-4 w-4 shrink-0 text-[var(--app-link)] animate-pulse" />
            <span className="truncate">
                {t('voice.focus.pill', { target: label ?? sessionId ?? '' })}
            </span>
            <button
                type="button"
                className="shrink-0 truncate text-[var(--app-link)] underline-offset-2 hover:underline"
                onClick={() => {
                    if (!sessionId) return
                    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                }}
            >
                {t('voice.focus.goToSession')}
            </button>
            <button
                type="button"
                className="shrink-0 rounded-full px-2 py-0.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                onClick={() => {
                    void voice.stopVoice()
                }}
            >
                {t('voice.end')}
            </button>
        </div>
    )
}
