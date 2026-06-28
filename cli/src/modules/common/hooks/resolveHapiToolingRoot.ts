import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const GUARD_REL = join('scripts', 'tooling', 'hapi-production-mutation-guard.sh');

/**
 * Resolve hapi repo root when session cwd is mirror, driver, or a worktree.
 * Returns null outside hapi — no project-scoped Claude guards then.
 */
export function resolveHapiToolingRoot(workingDirectory: string): string | null {
    const envPrimary = process.env.HAPI_PRIMARY?.trim();
    if (envPrimary && existsSync(join(envPrimary, GUARD_REL))) {
        return envPrimary;
    }

    let dir = workingDirectory;
    for (let depth = 0; depth < 12; depth += 1) {
        if (existsSync(join(dir, GUARD_REL))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }

    return null;
}

export function hapiClaudePreToolUseGuardCommand(hapiRoot: string): string {
    return join(hapiRoot, 'scripts', 'tooling', 'hapi-claude-pretooluse-guard.sh');
}
