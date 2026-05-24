import { useEffect, useMemo, useRef, useState } from 'react'
import { useXR } from '@react-three/xr'
import type { SessionSummary } from '@/types/api'

export const FIRST_ATTENTION_CUE_MS = 800
export const ATTENTION_LOOP_GAP_MS = 4200

export function useGardenAttention(sessions: SessionSummary[]): {
    seekingId: string | null
    playCue: (sessionId: string) => void
} {
    const isPresenting = useXR((state) => state.session !== undefined)
    const [seekingId, setSeekingId] = useState<string | null>(null)
    const lastIdRef = useRef<string | null>(null)
    const sessionsRef = useRef(sessions)
    sessionsRef.current = sessions

    const sessionIdsKey = useMemo(
        () => sessions.map((session) => session.id).sort().join('|'),
        [sessions]
    )

    const pickNext = (): string | null => {
        const list = sessionsRef.current
        if (list.length === 0) {
            return null
        }
        const pool = list.length > 1
            ? list.filter((session) => session.id !== lastIdRef.current)
            : list
        const pick = pool[Math.floor(Math.random() * pool.length)] ?? list[0]
        lastIdRef.current = pick.id
        return pick.id
    }

    const playCue = (sessionId: string) => {
        setSeekingId(sessionId)
    }

    useEffect(() => {
        if (!isPresenting) {
            setSeekingId(null)
            return
        }

        let cancelled = false
        const timers = new Set<ReturnType<typeof setTimeout>>()

        const schedule = (delay: number, fn: () => void) => {
            const id = setTimeout(() => {
                timers.delete(id)
                if (!cancelled) {
                    fn()
                }
            }, delay)
            timers.add(id)
        }

        const cueOnce = () => {
            const id = pickNext()
            if (id) {
                setSeekingId(id)
            }
        }

        const loop = () => {
            cueOnce()
            schedule(ATTENTION_LOOP_GAP_MS, loop)
        }

        schedule(FIRST_ATTENTION_CUE_MS, loop)

        return () => {
            cancelled = true
            for (const id of timers) {
                clearTimeout(id)
            }
        }
    }, [isPresenting, sessionIdsKey])

    return { seekingId, playCue }
}
