import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const GUARD_REL = join('scripts', 'tooling', 'hapi-production-mutation-guard.sh');

function isPathUnder(root: string, child: string): boolean {
    const normalizedRoot = resolve(root);
    const normalizedChild = resolve(child);
    return normalizedChild === normalizedRoot
        || normalizedChild.startsWith(`${normalizedRoot}/`);
}

/**
 * Resolve hapi repo root when session cwd is mirror, driver, or a worktree.
 * Returns null outside hapi — no project-scoped Claude guards then.
 *
 * HAPI_PRIMARY is only used as the tooling source after confirming the
 * working directory itself belongs to a HAPI checkout (walk finds the guard)
 * and the session cwd sits under that primary tree. Otherwise an exported
 * HAPI_PRIMARY would install estate guards into unrelated Claude sessions.
 */
export function resolveHapiToolingRoot(workingDirectory: string): string | null {
    let dir = workingDirectory;
    let foundInTree: string | null = null;
    for (let depth = 0; depth < 12; depth += 1) {
        if (existsSync(join(dir, GUARD_REL))) {
            foundInTree = resolve(dir);
            break;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }

    if (!foundInTree) {
        return null;
    }

    const envPrimary = process.env.HAPI_PRIMARY?.trim();
    if (
        envPrimary
        && isPathUnder(envPrimary, workingDirectory)
        && existsSync(join(envPrimary, GUARD_REL))
    ) {
        return resolve(envPrimary);
    }

    return foundInTree;
}

export function hapiClaudePreToolUseGuardCommand(hapiRoot: string): string {
    return join(hapiRoot, 'scripts', 'tooling', 'hapi-claude-pretooluse-guard.sh');
}
