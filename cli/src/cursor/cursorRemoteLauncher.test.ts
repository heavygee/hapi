import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Metadata } from '@hapi/protocol/schemas';
import type { CursorSession } from './session';

const legacyLauncher = vi.hoisted(() => vi.fn(async () => 'exit' as const));
const acpLauncher = vi.hoisted(() => vi.fn(async () => 'exit' as const));

vi.mock('./cursorLegacyRemoteLauncher', () => ({
    cursorLegacyRemoteLauncher: legacyLauncher
}));

vi.mock('./cursorAcpRemoteLauncher', () => ({
    cursorAcpRemoteLauncher: acpLauncher
}));

import { cursorRemoteLauncher } from './cursorRemoteLauncher';

const baseMetadata: Metadata = {
    flavor: 'cursor',
    path: '/tmp',
    host: 'test'
};

function makeSession(sessionId?: string): CursorSession {
    return { path: '/tmp', sessionId } as CursorSession;
}

describe('cursorRemoteLauncher', () => {
    beforeEach(() => {
        legacyLauncher.mockClear();
        acpLauncher.mockClear();
        acpLauncher.mockResolvedValue('exit');
        legacyLauncher.mockResolvedValue('exit');
    });

    it('uses ACP launcher for new sessions without cursorSessionId', async () => {
        await cursorRemoteLauncher(makeSession(), baseMetadata);

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).not.toHaveBeenCalled();
    });

    it('uses legacy launcher only when metadata marks a pre-ACP session', async () => {
        const legacyMetadata: Metadata = {
            ...baseMetadata,
            cursorSessionId: 'old-stream-json-id',
            cursorSessionProtocol: 'stream-json'
        };

        await cursorRemoteLauncher(makeSession(), legacyMetadata);

        expect(legacyLauncher).toHaveBeenCalledTimes(1);
        expect(acpLauncher).not.toHaveBeenCalled();
    });

    it('uses legacy launcher when cursorSessionId exists without protocol (pre-migration)', async () => {
        const legacyMetadata: Metadata = {
            ...baseMetadata,
            cursorSessionId: 'old-stream-json-id'
        };

        await cursorRemoteLauncher(makeSession(), legacyMetadata);

        expect(legacyLauncher).toHaveBeenCalledTimes(1);
        expect(acpLauncher).not.toHaveBeenCalled();
    });

    it('uses ACP launcher when cursorSessionProtocol is acp even with session id', async () => {
        const acpMetadata: Metadata = {
            ...baseMetadata,
            cursorSessionId: 'acp-session-id',
            cursorSessionProtocol: 'acp'
        };

        await cursorRemoteLauncher(makeSession(), acpMetadata);

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).not.toHaveBeenCalled();
    });

    it('does not fallback to stream-json when the ACP launcher fails', async () => {
        acpLauncher.mockRejectedValueOnce(new Error('Cursor ACP unavailable'));

        await expect(cursorRemoteLauncher(makeSession(), baseMetadata)).rejects.toThrow('Cursor ACP unavailable');

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).not.toHaveBeenCalled();
    });

    it('does not fallback to stream-json when ACP resume fails for an acp-marked session', async () => {
        const acpMetadata: Metadata = {
            ...baseMetadata,
            cursorSessionId: 'acp-session-id',
            cursorSessionProtocol: 'acp'
        };
        acpLauncher.mockRejectedValueOnce(new Error('Failed to resume Cursor ACP session'));

        await expect(cursorRemoteLauncher(makeSession(), acpMetadata)).rejects.toThrow('Failed to resume Cursor ACP session');

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).not.toHaveBeenCalled();
    });

    it('falls back to stream-json when ACP session/load fails on a legacy resume token', async () => {
        acpLauncher.mockRejectedValueOnce(
            new Error('Failed to resume Cursor ACP session. Legacy stream-json sessions cannot be loaded via ACP.')
        );

        const result = await cursorRemoteLauncher(makeSession('legacy-cursor-uuid'), baseMetadata);

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).toHaveBeenCalledTimes(1);
        expect(result).toBe('exit');
    });

    it('falls back to stream-json when ACP build does not support session/load', async () => {
        acpLauncher.mockRejectedValueOnce(
            new Error('Cursor ACP session/load is not supported by this agent build. Start a new Cursor session.')
        );

        await cursorRemoteLauncher(makeSession('legacy-cursor-uuid'), baseMetadata);

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).toHaveBeenCalledTimes(1);
    });

    it('does NOT fall back when ACP fails on a session without a resume token (fresh session)', async () => {
        acpLauncher.mockRejectedValueOnce(
            new Error('Failed to resume Cursor ACP session. Legacy stream-json sessions cannot be loaded via ACP.')
        );

        await expect(cursorRemoteLauncher(makeSession(), baseMetadata)).rejects.toThrow(
            /Legacy stream-json sessions cannot be loaded via ACP/
        );

        expect(acpLauncher).toHaveBeenCalledTimes(1);
        expect(legacyLauncher).not.toHaveBeenCalled();
    });
});
