import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getProjectPath(workingDirectory: string) {
    const projectId = resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects', projectId);
}

/**
 * Claude encodes `cwd` into `~/.claude/projects/<sanitized-cwd>/`. When
 * `session.path` is a symlink (e.g. `/home/.../hapi` → `/work/.../hapi`),
 * `resolve()` keeps the alias while Claude writes under the realpath.
 */
export function getProjectPathCandidates(workingDirectory: string): string[] {
    const seen = new Set<string>();
    const add = (dir: string) => {
        const projectPath = getProjectPath(dir);
        seen.add(projectPath);
    };
    add(workingDirectory);
    try {
        add(realpathSync(workingDirectory));
    } catch {
        // session.path may not exist yet; keep the unresolved candidate
    }
    return [...seen];
}
