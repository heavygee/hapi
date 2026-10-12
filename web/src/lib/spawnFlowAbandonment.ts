/**
 * Whether a navigation away from `/sessions/new` should be treated as
 * abandoning the spawn flow (and so should clean up its briefing/share-
 * transfer stash) — true for everything except staying on the route itself
 * or detouring through `/browse`, which `handleChooseFolder` uses as a
 * deliberate, expected continuation of the same spawn, not an abandonment
 * (hapi#238 Codex review).
 */
export function isAbandoningSpawnFlow(toPathname: string): boolean {
    return toPathname !== '/sessions/new' && toPathname !== '/browse'
}
