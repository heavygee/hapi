import type { VoiceFocus } from '@hapi/protocol/voice'
import { isSessionVoiceFocus } from '@hapi/protocol/voice'
import type { SessionSummary } from '@/types/api'
import { getSessionTitle } from '@/components/SessionList'

export type { VoiceFocus }
export { isSessionVoiceFocus }

export function getReceivingSessionId(focus: VoiceFocus | null): string | null {
    return isSessionVoiceFocus(focus) ? focus.ref : null
}

export function resolveVoiceFocusLabel(
    focus: VoiceFocus | null,
    sessions: readonly SessionSummary[],
    fallbackSessionId?: string | null
): string | null {
    if (!isSessionVoiceFocus(focus)) {
        return null
    }
    const session = sessions.find((s) => s.id === focus.ref)
    if (session) {
        return getSessionTitle(session)
    }
    if (fallbackSessionId === focus.ref) {
        return focus.ref.slice(0, 8)
    }
    return focus.ref.slice(0, 8)
}

export function isVoiceTransportActive(status: string): boolean {
    return status === 'connected' || status === 'connecting'
}
