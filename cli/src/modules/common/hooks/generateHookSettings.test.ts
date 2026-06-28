import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuration } from '@/configuration';
import {
    cleanupHookSettingsFile,
    generateHookSettingsFile
} from '@/modules/common/hooks/generateHookSettings';

describe('generateHookSettingsFile', () => {
    const created: string[] = [];

    afterEach(() => {
        for (const path of created.splice(0)) {
            cleanupHookSettingsFile(path, 'test');
        }
    });

    it('adds PreToolUse soup guard when workingDirectory is under hapi', () => {
        const path = generateHookSettingsFile(12345, 'test-token', {
            filenamePrefix: 'test-hook',
            logLabel: 'test',
            workingDirectory: '/home/heavygee/coding/hapi/worktrees/foo'
        });
        created.push(path);

        const settings = JSON.parse(readFileSync(path, 'utf8')) as {
            hooks: {
                SessionStart: unknown[];
                PreToolUse?: Array<{ matcher: string; hooks: Array<{ command: string }> }>;
            };
        };

        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.PreToolUse).toHaveLength(1);
        expect(settings.hooks.PreToolUse?.[0]?.matcher).toBe('Bash');
        expect(settings.hooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
            'hapi-claude-pretooluse-guard.sh'
        );
    });

    it('omits PreToolUse outside hapi repo', () => {
        const path = generateHookSettingsFile(12345, 'test-token', {
            filenamePrefix: 'test-hook-outside',
            logLabel: 'test',
            workingDirectory: '/tmp/not-hapi-project'
        });
        created.push(path);

        const settings = JSON.parse(readFileSync(path, 'utf8')) as {
            hooks: { PreToolUse?: unknown[] };
        };

        expect(settings.hooks.PreToolUse).toBeUndefined();
    });
});
