import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    cleanupHookSettingsFile,
    generateHookSettingsFile
} from '@/modules/common/hooks/generateHookSettings';
import { resolveHapiToolingRoot } from '@/modules/common/hooks/resolveHapiToolingRoot';

function makeFakeHapiTree(): { root: string; worktree: string } {
    const root = mkdtempSync(join(tmpdir(), 'hapi-hook-test-'));
    const tooling = join(root, 'scripts', 'tooling');
    mkdirSync(tooling, { recursive: true });
    writeFileSync(join(tooling, 'hapi-production-mutation-guard.sh'), '#!/usr/bin/env bash\n');
    writeFileSync(join(tooling, 'hapi-claude-pretooluse-guard.sh'), '#!/usr/bin/env bash\n');
    const worktree = join(root, 'worktrees', 'vitest-hook-settings');
    mkdirSync(worktree, { recursive: true });
    return { root, worktree };
}

describe('generateHookSettingsFile', () => {
    const created: string[] = [];
    let fakeHapiRoot: string | null = null;
    let cleanupWorktree: string | null = null;

    afterEach(() => {
        for (const path of created.splice(0)) {
            cleanupHookSettingsFile(path, 'test');
        }
        if (cleanupWorktree) {
            rmSync(cleanupWorktree, { recursive: true, force: true });
            cleanupWorktree = null;
        }
        if (fakeHapiRoot) {
            rmSync(fakeHapiRoot, { recursive: true, force: true });
            fakeHapiRoot = null;
        }
    });

    it('adds PreToolUse soup guard when workingDirectory is under hapi', () => {
        const liveRoot = resolveHapiToolingRoot(process.cwd());
        const { root, worktree } = liveRoot
            ? { root: liveRoot, worktree: join(liveRoot, 'worktrees', '.vitest-hook-settings') }
            : makeFakeHapiTree();
        fakeHapiRoot = liveRoot ? null : root;
        if (liveRoot) {
            mkdirSync(worktree, { recursive: true });
            cleanupWorktree = worktree;
        }

        const guardScript = join(root, 'scripts', 'tooling', 'hapi-claude-pretooluse-guard.sh');
        expect(existsSync(guardScript)).toBe(true);

        const path = generateHookSettingsFile(12345, 'test-token', {
            filenamePrefix: 'test-hook',
            logLabel: 'test',
            workingDirectory: worktree
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
