import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHapiToolingRoot } from '@/modules/common/hooks/resolveHapiToolingRoot';

function makeHapiTree(base: string): { root: string; worktree: string } {
    const tooling = join(base, 'scripts', 'tooling');
    mkdirSync(tooling, { recursive: true });
    writeFileSync(join(tooling, 'hapi-production-mutation-guard.sh'), '#!/usr/bin/env bash\n');
    const worktree = join(base, 'worktrees', 'vitest-resolve-root');
    mkdirSync(worktree, { recursive: true });
    return { root: base, worktree };
}

describe('resolveHapiToolingRoot', () => {
    const cleanup: string[] = [];
    const prevPrimary = process.env.HAPI_PRIMARY;

    afterEach(() => {
        for (const dir of cleanup.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
        if (prevPrimary === undefined) {
            delete process.env.HAPI_PRIMARY;
        } else {
            process.env.HAPI_PRIMARY = prevPrimary;
        }
    });

    it('walks upward from a worktree cwd', () => {
        const base = mkdtempSync(join(tmpdir(), 'hapi-resolve-'));
        cleanup.push(base);
        const { root, worktree } = makeHapiTree(base);
        expect(resolveHapiToolingRoot(worktree)).toBe(root);
    });

    it('uses HAPI_PRIMARY only when cwd is under that tree', () => {
        const hapi = mkdtempSync(join(tmpdir(), 'hapi-primary-'));
        const other = mkdtempSync(join(tmpdir(), 'other-repo-'));
        cleanup.push(hapi, other);
        const { worktree } = makeHapiTree(hapi);
        process.env.HAPI_PRIMARY = hapi;

        expect(resolveHapiToolingRoot(worktree)).toBe(hapi);
        expect(resolveHapiToolingRoot(other)).toBeNull();
    });

    it('returns null outside any hapi tree', () => {
        const outside = mkdtempSync(join(tmpdir(), 'outside-'));
        cleanup.push(outside);
        mkdirSync(outside, { recursive: true });
        expect(resolveHapiToolingRoot(outside)).toBeNull();
        expect(existsSync(join(outside, 'scripts', 'tooling', 'hapi-production-mutation-guard.sh'))).toBe(false);
    });
});
