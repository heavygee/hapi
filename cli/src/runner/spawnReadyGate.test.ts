import { describe, expect, it } from 'vitest';
import { agentRequiresSpawnReady, resolveAgentReadyTimeoutMs } from './spawnReadyGate';

describe('spawnReadyGate', () => {
    it('requires agent-ready for cursor runner spawns', () => {
        expect(agentRequiresSpawnReady('cursor')).toBe(true);
        expect(agentRequiresSpawnReady('claude')).toBe(false);
        expect(agentRequiresSpawnReady('codex')).toBe(false);
    });

    it('respects HAPI_RUNNER_READY_TIMEOUT_MS', () => {
        const previous = process.env.HAPI_RUNNER_READY_TIMEOUT_MS;
        process.env.HAPI_RUNNER_READY_TIMEOUT_MS = '90000';
        expect(resolveAgentReadyTimeoutMs()).toBe(90_000);
        if (previous === undefined) {
            delete process.env.HAPI_RUNNER_READY_TIMEOUT_MS;
        } else {
            process.env.HAPI_RUNNER_READY_TIMEOUT_MS = previous;
        }
    });
});
