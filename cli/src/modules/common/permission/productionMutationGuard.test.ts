import { describe, expect, it } from 'vitest';
import {
    matchesProductionMutation,
    matchesRemoteProductionMutation,
    shouldDenyAgentShellCommand,
} from './productionMutationGuard';

describe('productionMutationGuard', () => {
    it('blocks the 2026-06-20 incident command shape over ssh', () => {
        const cmd =
            'ssh server "kill 60544 && hapi-driver-db-prep.sh cross-flavor && nohup bun run src/index.ts"';
        expect(matchesRemoteProductionMutation(cmd)).toBe(true);
        expect(
            shouldDenyAgentShellCommand({ title: cmd, kind: 'execute' }).deny,
        ).toBe(true);
    });

    it('allows read-only ssh diagnostics', () => {
        const cmd = 'ssh server "cd ~/coding/hapi/driver && git status -sb"';
        expect(matchesRemoteProductionMutation(cmd)).toBe(false);
        expect(shouldDenyAgentShellCommand({ title: cmd, kind: 'execute' }).deny).toBe(false);
    });

    it('blocks local manual hub nohup without ssh prefix', () => {
        const cmd = 'cd hub && nohup bun run src/index.ts >> manual-hub.log';
        expect(matchesProductionMutation(cmd)).toBe(true);
        expect(shouldDenyAgentShellCommand({ title: cmd }).deny).toBe(true);
    });
});
