import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, Session } from '@/types/api'
import { getMessageWindowState, syncTailMessages } from '@/lib/message-window-store'
import { registerVoiceHooksStore, voiceHooks } from '@/realtime/hooks/voiceHooks'

export type GardenVoicePrefetch = {
    session: Session
    messages: DecryptedMessage[]
}

/**
 * Load session + messages before voice connect so bootstrap is not empty.
 * Garden dwell-focus often beats React query hydration — without this, agents
 * greet with no context ("Session not available" / hello-only).
 */
export async function prefetchGardenVoiceContext(
    api: ApiClient,
    sessionId: string,
): Promise<GardenVoicePrefetch | null> {
    const [response] = await Promise.all([
        api.getSession(sessionId),
        syncTailMessages(api, sessionId),
    ])
    const messages = getMessageWindowState(sessionId).messages
    return { session: response.session, messages }
}

export function primeVoiceHooksForGarden(prefetch: GardenVoicePrefetch): void {
    const sessionId = prefetch.session.id
    registerVoiceHooksStore(
        (id) => (id === sessionId ? prefetch.session : null),
        (id) => (id === sessionId ? prefetch.messages : []),
    )
}

export function notifyGardenSessionFocus(
    sessionId: string,
    metadata: GardenVoicePrefetch['session']['metadata'],
): void {
    voiceHooks.onSessionFocus(sessionId, metadata ?? undefined)
}
