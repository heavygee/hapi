import { randomBytes } from 'node:crypto'
import { constantTimeEquals } from '../utils/crypto'

/**
 * One-time resume peer-mint nonce (#1203 pass 2h B1).
 *
 * Armed when the hub asks the runner to spawn a resume. The nonce travels only
 * on the machine spawn RPC (RpcRegistry refuses method shadowing). The runner
 * redeems it over HTTP for a capability and injects into the child — the CLI
 * socket connect path must NOT consume this (first-connector TOCTOU).
 */

export const RESUME_PEER_MINT_TTL_MS = 30_000

type PendingMint = {
    nonce: string
    expiresAt: number
}

const pendingBySessionId = new Map<string, PendingMint>()

/** Arm a mint and return the nonce to send on the machine spawn RPC only. */
export function armResumePeerMint(
    sessionId: string,
    nowMs: number = Date.now(),
    ttlMs: number = RESUME_PEER_MINT_TTL_MS
): string | undefined {
    const id = sessionId.trim()
    if (!id) {
        return undefined
    }
    // Idempotent while unexpired: concurrent /resume can dedupe the runner
    // spawn, so a second arm must not invalidate the nonce the first child
    // will redeem (#1473 Major).
    const existing = pendingBySessionId.get(id)
    if (existing && existing.expiresAt >= nowMs) {
        return existing.nonce
    }
    const nonce = randomBytes(32).toString('base64url')
    pendingBySessionId.set(id, { nonce, expiresAt: nowMs + ttlMs })
    return nonce
}

export function clearResumePeerMint(sessionId: string): void {
    pendingBySessionId.delete(sessionId.trim())
}

/**
 * Consume a mint only when the caller presents the matching nonce.
 * Used by the runner redeem HTTP route — not by anonymous /cli connect.
 */
export function redeemResumePeerMint(
    sessionId: string,
    nonce: string | undefined,
    nowMs: number = Date.now()
): boolean {
    const id = sessionId.trim()
    const presented = typeof nonce === 'string' ? nonce.trim() : ''
    if (!id || !presented) {
        return false
    }
    const entry = pendingBySessionId.get(id)
    if (!entry) {
        return false
    }
    if (entry.expiresAt < nowMs) {
        pendingBySessionId.delete(id)
        return false
    }
    if (!constantTimeEquals(presented, entry.nonce)) {
        return false
    }
    pendingBySessionId.delete(id)
    return true
}

/** @deprecated Removed — first-connector consume was the pass2h Blocker. */
export function consumeResumePeerMint(_sessionId: string, _nowMs?: number): boolean {
    return false
}

export function clearResumePeerMintsForTests(): void {
    pendingBySessionId.clear()
}
