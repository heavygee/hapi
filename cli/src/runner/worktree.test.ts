import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorktree, removeWorktree } from './worktree';

const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, args: string[]) {
    execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], env: gitEnv });
}

describe('createWorktree', () => {
    const roots: string[] = [];

    afterEach(() => {
        while (roots.length > 0) {
            const root = roots.pop();
            if (root) {
                rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it('creates an isolated linked worktree with its own branch', async () => {
        const main = mkdtempSync(join(tmpdir(), 'hapi-wt-main-'));
        roots.push(main);
        git(main, ['init']);
        writeFileSync(join(main, 'README'), 'x\n');
        git(main, ['add', 'README']);
        git(main, ['commit', '-m', 'init']);

        const result = await createWorktree({ basePath: main, nameHint: 'peer-feature' });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        roots.push(join(dirname(main), `${basename(main)}-worktrees`));
        expect(result.info.worktreePath).not.toBe(main);
        expect(result.info.basePath).toBe(main);

        const removed = await removeWorktree({
            repoRoot: result.info.basePath,
            worktreePath: result.info.worktreePath,
        });
        expect(removed.ok).toBe(true);
    });
});
