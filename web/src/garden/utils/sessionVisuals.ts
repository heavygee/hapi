import type { SessionSummary } from '@/types/api'

export const GARDEN_BUILD = 'r3f-v4'

export const LAYOUT_ARC_RAD = (270 / 180) * Math.PI
export const ORB_RADIUS = 4.8
export const ORB_Z_PUSH = 1.2
export const ORB_BASE_Y = 0.38
export const ORB_Y_STAGGER = 0.24
export const DWELL_SECONDS = 1.2
export const ATTENTION_COLOR = '#f97316'

/** Local orb space: +Z toward the viewer (camera sits near origin, orbs at -Z). */
export const ORB_LABEL_POSITION: [number, number, number] = [0, 0.42, -0.22]
export const SNIPPET_COMPACT_POSITION: [number, number, number] = [0, 0.56, 0.48]
export const SNIPPET_FOCUS_POSITION: [number, number, number] = [0, 0.78, 0.72]
export const LIVE_WEB_PANEL_POSITION: [number, number, number] = [0, 0.92, 0.82]

export function layoutPosition(index: number, total: number): [number, number, number] {
    const start = -LAYOUT_ARC_RAD / 2
    const t = total <= 1 ? 0.5 : index / (total - 1)
    const angle = start + LAYOUT_ARC_RAD * t
    const x = Math.sin(angle) * ORB_RADIUS
    const y = ORB_BASE_Y + (index % 3) * ORB_Y_STAGGER
    const z = -(Math.cos(angle) * ORB_RADIUS + ORB_Z_PUSH)
    return [x, y, z]
}

export function sessionLabel(session: SessionSummary): string {
    const meta = session.metadata
    if (meta?.summary?.text) {
        return meta.summary.text.slice(0, 40)
    }
    if (meta?.path) {
        const parts = meta.path.split('/').filter(Boolean)
        return parts[parts.length - 1] || meta.path
    }
    return session.id.slice(0, 8)
}

export function sessionColor(session: SessionSummary): string {
    if (session.pendingRequestsCount > 0) {
        return '#ef4444'
    }
    if (session.thinking) {
        return '#eab308'
    }
    if (session.active) {
        return '#22d3ee'
    }
    return '#475569'
}

export function filterGardenSessions(sessions: SessionSummary[]): SessionSummary[] {
    const hot = sessions.filter((session) => session.active || session.thinking || session.pendingRequestsCount > 0)
    const hotIds = new Set(hot.map((session) => session.id))

    const recentRest = sessions
        .filter((session) => !hotIds.has(session.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)

    return [...hot, ...recentRest]
        .sort((a, b) => {
            const aScore = (a.pendingRequestsCount > 0 ? 4 : 0) + (a.thinking ? 2 : 0) + (a.active ? 1 : 0)
            const bScore = (b.pendingRequestsCount > 0 ? 4 : 0) + (b.thinking ? 2 : 0) + (b.active ? 1 : 0)
            if (aScore !== bScore) {
                return bScore - aScore
            }
            return b.updatedAt - a.updatedAt
        })
        .slice(0, 8)
}
