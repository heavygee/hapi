import { useEffect, useRef, useState } from 'react'
import { useXR } from '@react-three/xr'
import type { SessionSummary } from '@/types/api'
import { getGardenSeen, markGardenSeen } from '@/garden/store/gardenSeenStore'
import {
    attentionReasonForSession,
    sessionNeedsGardenAttention,
} from '@/garden/utils/gardenSeenAttention'
import {
    createAttentionRecord,
    detectAttentionEvents,
    pickAttentionReason,
    shouldClearAttention,
    shouldPingSession,
    sessionAttentionSnapshot,
    type AttentionRecord,
    type SessionAttentionSnapshot,
} from '@/garden/utils/gardenAttentionEvents'

export function useGardenAttention(sessions: SessionSummary[], focusedId: string | null): {
    attentionIds: ReadonlySet<string>
    attentionCueTokens: Readonly<Record<string, number>>
} {
    const isPresenting = useXR((state) => state.session !== undefined)
    const attentionRef = useRef<Map<string, AttentionRecord>>(new Map())
    const cueTokensRef = useRef<Record<string, number>>({})
    const prevByIdRef = useRef<Map<string, SessionAttentionSnapshot>>(new Map())
    const vrSeededRef = useRef(false)
    const [attentionIds, setAttentionIds] = useState<ReadonlySet<string>>(() => new Set())
    const [attentionCueTokens, setAttentionCueTokens] = useState<Readonly<Record<string, number>>>({})

    const syncAttention = () => {
        setAttentionIds(new Set(attentionRef.current.keys()))
        setAttentionCueTokens({ ...cueTokensRef.current })
    }

    const bumpCue = (sessionId: string) => {
        cueTokensRef.current[sessionId] = (cueTokensRef.current[sessionId] ?? 0) + 1
    }

    const markSeenAndClear = (sessionId: string, session: SessionSummary) => {
        markGardenSeen(sessionId, session.updatedAt)
        attentionRef.current.delete(sessionId)
        syncAttention()
    }

    useEffect(() => {
        if (!isPresenting) {
            vrSeededRef.current = false
            attentionRef.current.clear()
            prevByIdRef.current.clear()
            syncAttention()
            return
        }

        const prevById = prevByIdRef.current
        const liveIds = new Set<string>()

        if (!vrSeededRef.current) {
            vrSeededRef.current = true
            for (const session of sessions) {
                prevById.set(session.id, sessionAttentionSnapshot(session))
                if (
                    shouldPingSession(session.id, focusedId)
                    && sessionNeedsGardenAttention(session, getGardenSeen(session.id))
                ) {
                    attentionRef.current.set(
                        session.id,
                        createAttentionRecord(attentionReasonForSession(session), session.updatedAt),
                    )
                }
            }
            syncAttention()
        }

        for (const session of sessions) {
            liveIds.add(session.id)
            const next = sessionAttentionSnapshot(session)
            const prev = prevById.get(session.id)
            const reasons = detectAttentionEvents(prev, next)

            if (reasons.length > 0 && shouldPingSession(session.id, focusedId)) {
                const reason = pickAttentionReason(reasons)
                const existing = attentionRef.current.get(session.id)
                if (!existing) {
                    attentionRef.current.set(
                        session.id,
                        createAttentionRecord(reason, session.updatedAt),
                    )
                } else {
                    existing.reason = reason
                }
                bumpCue(session.id)
            }

            const record = attentionRef.current.get(session.id)
            if (record && shouldClearAttention(record, session)) {
                markSeenAndClear(session.id, session)
            }

            prevById.set(session.id, next)
        }

        for (const id of prevById.keys()) {
            if (!liveIds.has(id)) {
                prevById.delete(id)
                attentionRef.current.delete(id)
            }
        }

        syncAttention()
    }, [sessions, focusedId, isPresenting])

    useEffect(() => {
        if (!focusedId) {
            return
        }

        const session = sessions.find((row) => row.id === focusedId)
        const record = attentionRef.current.get(focusedId)
        if (!session || !record || record.focusBaselineUpdatedAt !== null) {
            return
        }

        record.focusBaselineUpdatedAt = session.updatedAt

        if (shouldClearAttention(record, session)) {
            markSeenAndClear(focusedId, session)
        } else {
            syncAttention()
        }
    }, [focusedId, sessions])

    return { attentionIds, attentionCueTokens }
}
