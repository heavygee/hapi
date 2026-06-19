import type { SessionSummary } from '@/types/api'

export const GARDEN_BUILD = 'r3f-v13'

/** Max orbs in the garden (Quest performance budget). */
export const GARDEN_VISIBLE_CAP = 25

export const LAYOUT_ARC_RAD = (270 / 180) * Math.PI
export const LAYOUT_ROWS = 3
/** Elevation per row: top (+pitch), horizon, bottom (-pitch). */
export const LAYOUT_ROW_PITCH_RAD = (20 / 180) * Math.PI
export const ORB_RADIUS = 4.8
export const ORB_Z_PUSH = 1.2
export const ORB_BASE_Y = 0.38
/** Invisible gaze/pointer hit sphere (visual platonic body is smaller). */
export const ORB_HIT_RADIUS = 1.05
export const DWELL_SECONDS = 1.0
export const ATTENTION_COLOR = '#f97316'

/** Local orb space: +Z toward the viewer (camera sits near origin, orbs at -Z). */
export const ORB_LABEL_POSITION: [number, number, number] = [0, 0.42, -0.22]
export const SNIPPET_COMPACT_POSITION: [number, number, number] = [0, 0.56, 0.48]
export const SNIPPET_FOCUS_POSITION: [number, number, number] = [0, 0.78, 0.72]
export const LIVE_WEB_PANEL_POSITION: [number, number, number] = [0, 0.92, 0.82]

const ROW_ELEVATIONS = [
    LAYOUT_ROW_PITCH_RAD,
    0,
    -LAYOUT_ROW_PITCH_RAD,
] as const

/**
 * Column-major on a partial sphere: each horizontal slot stacks 3 rows
 * (look up / ahead / down), columns spread on a 270° arc.
 */
export function layoutPosition(index: number, total: number): [number, number, number] {
    const row = index % LAYOUT_ROWS
    const col = Math.floor(index / LAYOUT_ROWS)
    const colsInRow = Math.ceil(total / LAYOUT_ROWS)
    const elevation = ROW_ELEVATIONS[row] ?? 0

    const start = -LAYOUT_ARC_RAD / 2
    const t = colsInRow <= 1 ? 0.5 : col / (colsInRow - 1)
    const azimuth = start + LAYOUT_ARC_RAD * t

    const horizontalRadius = ORB_RADIUS * Math.cos(elevation)
    const x = Math.sin(azimuth) * horizontalRadius
    const y = ORB_BASE_Y + Math.sin(elevation) * ORB_RADIUS
    const z = -(Math.cos(azimuth) * horizontalRadius + ORB_Z_PUSH)
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
    if (session.pendingRequestKinds.length > 0) {
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

/** Hot sessions first, then recently updated active sessions, up to {@link GARDEN_VISIBLE_CAP}. */
export function filterGardenSessions(sessions: SessionSummary[]): SessionSummary[] {
    const hot = sessions.filter(
        (session) => session.active || session.thinking || session.pendingRequestKinds.length > 0,
    )
    const hotIds = new Set(hot.map((session) => session.id))

    const recentActive = sessions
        .filter((session) => session.active && !hotIds.has(session.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)

    return [...hot, ...recentActive]
        .sort((a, b) => {
            const aScore = (a.pendingRequestKinds.length > 0 ? 4 : 0) + (a.thinking ? 2 : 0) + (a.active ? 1 : 0)
            const bScore = (b.pendingRequestKinds.length > 0 ? 4 : 0) + (b.thinking ? 2 : 0) + (b.active ? 1 : 0)
            if (aScore !== bScore) {
                return bScore - aScore
            }
            return b.updatedAt - a.updatedAt
        })
        .slice(0, GARDEN_VISIBLE_CAP)
}
