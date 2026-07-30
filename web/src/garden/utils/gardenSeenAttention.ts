import type { GardenSeenRecord } from '@/garden/store/gardenSeenStore'

/** True when web-equivalent state says this session still needs operator attention. */
export function sessionNeedsGardenAttention(
    session: {
        pendingRequestKinds: readonly string[]
        updatedAt: number
        thinking: boolean
    },
    seen: GardenSeenRecord | null,
): boolean {
    if (session.pendingRequestKinds.length > 0) {
        return true
    }

    if (session.thinking) {
        return false
    }

    if (!seen) {
        return session.updatedAt > 0
    }

    return session.updatedAt > seen.updatedAt
}

export function attentionReasonForSession(session: {
    pendingRequestKinds: readonly string[]
}): 'permission' | 'ready' {
    return session.pendingRequestKinds.length > 0 ? 'permission' : 'ready'
}
