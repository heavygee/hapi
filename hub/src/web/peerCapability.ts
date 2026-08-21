import { createHmac } from 'node:crypto'
import { constantTimeEquals } from '../utils/crypto'

const PEER_CAPABILITY_PREFIX = 'hapi-peer-cap-v1:'

/**
 * Mint a session-scoped peer-delivery capability. Bound to sessionId via HMAC
 * over the hub JWT secret (not the shared CLI API token). Callers with only
 * the namespace CLI token cannot forge another session's capability.
 */
export function mintPeerSessionCapability(
    sessionId: string,
    jwtSecret: Uint8Array
): string {
    return createHmac('sha256', Buffer.from(jwtSecret))
        .update(`${PEER_CAPABILITY_PREFIX}${sessionId}`)
        .digest('base64url')
}

export function verifyPeerSessionCapability(
    sessionId: string,
    capability: string | undefined,
    jwtSecret: Uint8Array
): boolean {
    if (typeof capability !== 'string' || !capability.trim()) {
        return false
    }
    const expected = mintPeerSessionCapability(sessionId, jwtSecret)
    return constantTimeEquals(capability.trim(), expected)
}
