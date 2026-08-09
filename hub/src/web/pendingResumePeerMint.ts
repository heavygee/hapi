/**
 * One-time peer-capability mint for runner-resumed sessions (#1203 pass 2g B1).
 *
 * The create-time session tag must never enter the resumed CLI process
 * (environ / inherited fd / pidfd_getfd). Instead the hub arms a short-lived
 * single-use mint when it asks the runner to spawn the resume; the next CLI
 * socket that joins that sessionId consumes it.
 *
 * Residual: a same-namespace peer that connects as the victim sessionId during
 * the arm window can win the one-shot. There is no durable mint-proof to steal
 * from the child afterward.
 */

export const RESUME_PEER_MINT_TTL_MS = 30_000

type PendingMint = {
    expiresAt: number
}

const pendingBySessionId = new Map<string, PendingMint>()

export function armResumePeerMint(
    sessionId: string,
    nowMs: number = Date.now(),
    ttlMs: number = RESUME_PEER_MINT_TTL_MS
): void {
    const id = sessionId.trim()
    if (!id) {
        return
    }
    pendingBySessionId.set(id, { expiresAt: nowMs + ttlMs })
}

/** Returns true once if a non-expired mint was armed; consumes it. */
export function consumeResumePeerMint(
    sessionId: string,
    nowMs: number = Date.now()
): boolean {
    const id = sessionId.trim()
    if (!id) {
        return false
    }
    const entry = pendingBySessionId.get(id)
    if (!entry) {
        return false
    }
    pendingBySessionId.delete(id)
    return entry.expiresAt >= nowMs
}

/** Test helper — clear all armed mints. */
export function clearResumePeerMintsForTests(): void {
    pendingBySessionId.clear()
}
