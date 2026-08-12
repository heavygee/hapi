/**
 * Host-computed even-arc fan for the vendored dock.
 * Drop this overlay when a hapi-inline tag lands https://github.com/heavygee/hapi-inline/issues/112
 * Do not edit vendored operator-dock.css — keep the numbers here + in hapi-boot.js.
 */

export const FAN_RADIUS_PX = 108
export const FAN_PLATE_PX = 168
export const FAN_SAT_PX = 44
export const FAN_MIN_GAP_PX = 10
export const FAN_MIN_CENTER_DIST_PX = FAN_SAT_PX + FAN_MIN_GAP_PX
export const FAN_ARC_START_DEG = 90
export const FAN_ARC_END_DEG = 180
export const FAN_TOOLS = ['sessions', 'markup', 'mic', 'settings'] as const

export type FanTool = (typeof FAN_TOOLS)[number]
export type FanTranslate = { x: number; y: number }

/** θ from +x CCW; CSS y is down so ty = -R sin θ. Default sat center == hub center. */
export function fanTranslate(
    index: number,
    count = FAN_TOOLS.length,
    radius = FAN_RADIUS_PX
): FanTranslate & { deg: number } {
    const t = count <= 1 ? 0 : index / (count - 1)
    const deg = FAN_ARC_START_DEG + t * (FAN_ARC_END_DEG - FAN_ARC_START_DEG)
    const rad = (deg * Math.PI) / 180
    return {
        x: Math.round(radius * Math.cos(rad)) || 0,
        y: Math.round(-radius * Math.sin(rad)) || 0,
        deg
    }
}

export function fanSatTranslates(
    radius = FAN_RADIUS_PX
): Record<FanTool, FanTranslate> {
    const out = {} as Record<FanTool, FanTranslate>
    FAN_TOOLS.forEach((tool, i) => {
        const { x, y } = fanTranslate(i, FAN_TOOLS.length, radius)
        out[tool] = { x, y }
    })
    return out
}

export function satCenterDistance(a: FanTranslate, b: FanTranslate): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}
