export type SpawnFlowRoute = '/sessions/new' | '/browse'

/**
 * Whether a navigation away from `fromPathname` (either leg of the to-do
 * spawn flow — `/sessions/new`, or its "Choose folder" detour through
 * `/browse`) should be treated as abandoning the flow, and so should clean
 * up its briefing/share-transfer stash. False only for staying put or
 * crossing between the two legs of the same deliberate round trip; true for
 * everything else, including browser/device back-driven navigation, which
 * runs no explicit Cancel/Back handler on either page (hapi#238 Codex
 * review, two passes — the second covering `/browse` specifically, which
 * has its own copy of the same briefing/transfer in its own search params
 * and no cleanup of its own).
 */
export function isAbandoningSpawnFlow(fromPathname: SpawnFlowRoute, toPathname: string): boolean {
    if (toPathname === fromPathname) return false
    const otherLeg: SpawnFlowRoute = fromPathname === '/sessions/new' ? '/browse' : '/sessions/new'
    return toPathname !== otherLeg
}
