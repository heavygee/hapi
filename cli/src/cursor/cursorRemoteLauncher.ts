import type { Metadata } from '@hapi/protocol/schemas';
import { logger } from '@/ui/logger';
import type { CursorSession } from './session';
import { cursorAcpRemoteLauncher } from './cursorAcpRemoteLauncher';
import { cursorLegacyRemoteLauncher } from './cursorLegacyRemoteLauncher';
import { resolveCursorRemoteProtocol } from './utils/cursorProtocol';

const LEGACY_FALLBACK_ERROR_PATTERN = /Legacy stream-json sessions cannot be loaded via ACP|session\/load is not supported/i;

export async function cursorRemoteLauncher(
    session: CursorSession,
    metadata?: Metadata | null
): Promise<'switch' | 'exit'> {
    const protocol = resolveCursorRemoteProtocol(metadata);
    if (protocol === 'stream-json') {
        return cursorLegacyRemoteLauncher(session);
    }
    try {
        return await cursorAcpRemoteLauncher(session);
    } catch (error) {
        if (session.sessionId && LEGACY_FALLBACK_ERROR_PATTERN.test(error instanceof Error ? error.message : String(error))) {
            logger.warn('[cursor] ACP load failed for legacy resume token; falling back to stream-json launcher', error);
            return cursorLegacyRemoteLauncher(session);
        }
        throw error;
    }
}
