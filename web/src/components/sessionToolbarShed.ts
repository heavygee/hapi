/**
 * Session-list toolbar keep ranks (tiann/hapi#2039 / #2040).
 *
 * Lower `keep` stays on the row longer. Higher `keep` moves into More first.
 * Rank is survival, not paint order. Search is not a slot: it never sheds.
 *
 * Upstream controls:
 *   4 New
 *   5 Session filter (unread lens)
 *   6 Settings
 *   7 Mark all read (#1773 bulk hygiene — reachable, not a neighbor of New)
 *   8 Browse
 * Machine chips / the mobile machine menu stay outside this ladder.
 * Fork-only Kitchen, Overseer, and agent-import use the same `keep` scale
 * when a soup layer passes them as extras (3 / 9 / 10).
 */

export type ToolbarShedSlot = {
    id: string
    /** Higher sheds first. */
    keep: number
    widthPx: number
}

export const TOOLBAR_ICON_PX = 40
export const TOOLBAR_MORE_PX = 40
export const TOOLBAR_GAP_PX = 4

/** Horizontal budget left for action slots after search chrome and row padding. */
export function toolbarActionBudget(headerRowWidth: number, hasQuery: boolean): number {
    if (headerRowWidth <= 0) {
        // Unmeasured: don't flash a crowded row on an idle list. A query chip
        // is already wide, so assume a phone-sized remainder.
        return hasQuery ? 72 : Number.POSITIVE_INFINITY
    }
    const searchReserve = hasQuery ? 200 : 56
    const rowPadding = 16
    return Math.max(0, headerRowWidth - searchReserve - rowPadding)
}

function clusterWidth(slots: readonly ToolbarShedSlot[], includeMore: boolean): number {
    const itemCount = slots.length + (includeMore ? 1 : 0)
    if (itemCount === 0) return 0
    const icons = slots.reduce((sum, slot) => sum + slot.widthPx, 0) + (includeMore ? TOOLBAR_MORE_PX : 0)
    return icons + TOOLBAR_GAP_PX * (itemCount - 1)
}

/**
 * Drop the highest `keep` until the cluster fits. Paint order of survivors
 * matches input order.
 */
export function shedToolbarSlots(
    slots: readonly ToolbarShedSlot[],
    budgetPx: number
): { visibleIds: string[]; overflowIds: string[] } {
    const overflow: ToolbarShedSlot[] = []
    let visible = [...slots]
    while (visible.length > 0 && clusterWidth(visible, overflow.length > 0) > budgetPx) {
        let worstIndex = 0
        for (let index = 1; index < visible.length; index += 1) {
            const candidate = visible[index]
            const worst = visible[worstIndex]
            if (!candidate || !worst) continue
            if (candidate.keep > worst.keep) worstIndex = index
        }
        const [removed] = visible.splice(worstIndex, 1)
        if (removed) overflow.push(removed)
    }
    const order = new Map(slots.map((slot, index) => [slot.id, index]))
    const byPaint = (a: ToolbarShedSlot, b: ToolbarShedSlot) =>
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    visible.sort(byPaint)
    overflow.sort(byPaint)
    return {
        visibleIds: visible.map((slot) => slot.id),
        overflowIds: overflow.map((slot) => slot.id)
    }
}
