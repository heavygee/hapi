/**
 * In-process session relay used by Overseer `ping_session`.
 *
 * Resume may mint a replacement hub session ID (spawn + merge). Delivery must
 * target that returned ID — sending to the pre-resume id hits a deleted row.
 */

export type SessionRelayResumeResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message?: string; code?: string }

export type SessionRelayResult = {
    ok: boolean
    resumed: boolean
    /** Session id that received (or would receive) the message after remaps. */
    sessionId: string
    error?: string
}

export type SessionRelayDeps = {
    getSession: (sessionId: string) => { active: boolean } | undefined
    resumeSession: (sessionId: string, namespace: string) => Promise<SessionRelayResumeResult>
    sendMessage: (sessionId: string, payload: { text: string; sentFrom: 'webapp' }) => Promise<void>
}

export async function executeSessionRelay(
    deps: SessionRelayDeps,
    args: { sessionId: string; message: string; namespace?: string }
): Promise<SessionRelayResult> {
    const namespace = args.namespace ?? 'default'
    const existing = deps.getSession(args.sessionId)
    if (!existing) {
        return { ok: false, resumed: false, sessionId: args.sessionId, error: 'session_not_found' }
    }

    let deliverySessionId = args.sessionId
    let resumed = false
    if (!existing.active) {
        const resume = await deps.resumeSession(args.sessionId, namespace)
        if (resume.type !== 'success') {
            return {
                ok: false,
                resumed: false,
                sessionId: args.sessionId,
                error: resume.code ?? resume.message ?? 'resume_failed'
            }
        }
        deliverySessionId = resume.sessionId
        resumed = true
    }

    try {
        await deps.sendMessage(deliverySessionId, { text: args.message, sentFrom: 'webapp' })
        return { ok: true, resumed, sessionId: deliverySessionId }
    } catch (error) {
        return {
            ok: false,
            resumed,
            sessionId: deliverySessionId,
            error: error instanceof Error ? error.message : 'send_failed'
        }
    }
}
