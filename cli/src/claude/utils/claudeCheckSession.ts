import { logger } from "@/ui/logger";
import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getProjectPath } from "./path";

function encodeProjectId(workingDirectory: string): string {
    return resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
}

function claudeProjectsRoot(home?: string): string {
    if (process.env.CLAUDE_CONFIG_DIR) {
        return join(process.env.CLAUDE_CONFIG_DIR, 'projects');
    }
    return join(home || homedir(), '.claude', 'projects');
}

function transcriptLooksValid(sessionFile: string): boolean {
    if (!existsSync(sessionFile)) {
        return false;
    }
    try {
        // Only scan a prefix — Claude transcripts can be tens of MB and this
        // probe runs on the runner RPC thread during reopen.
        const fd = openSync(sessionFile, 'r');
        try {
            const buf = Buffer.alloc(64 * 1024);
            const bytesRead = readSync(fd, buf, 0, buf.length, 0);
            const prefix = buf.toString('utf-8', 0, bytesRead);
            return prefix.split('\n').some((line) => {
                if (!line.trim()) return false;
                try {
                    return typeof JSON.parse(line).uuid === 'string';
                } catch {
                    return false;
                }
            });
        } finally {
            closeSync(fd);
        }
    } catch {
        return false;
    }
}

function candidateProjectDirs(workspacePath: string, home?: string): string[] {
    const projectsRoot = claudeProjectsRoot(home);
    const dirs = new Set<string>();
    // getProjectPath respects CLAUDE_CONFIG_DIR; when probing a recorded home
    // without mutating env, build the slug under that home explicitly.
    if (home && !process.env.CLAUDE_CONFIG_DIR) {
        dirs.add(join(projectsRoot, encodeProjectId(workspacePath)));
    } else {
        dirs.add(getProjectPath(workspacePath));
    }

    try {
        const real = realpathSync(workspacePath);
        if (real !== resolve(workspacePath)) {
            dirs.add(join(projectsRoot, encodeProjectId(real)));
        }
    } catch {
        // workspace may not exist yet — keep the resolved slug only
    }

    return [...dirs];
}

/**
 * On-disk probe for a Claude Code transcript (Cursor #841 spirit).
 * Checks the workspace project slug, a realpath alternate when different,
 * then a cross-project scan under ~/.claude/projects (Claude CLI does the
 * same for --resume by UUID).
 */
export function inspectClaudeTranscript(opts: {
    sessionId: string
    workspacePath: string
    home?: string
}): { onDisk: boolean } {
    const sessionId = opts.sessionId.trim();
    if (!sessionId || sessionId === '.' || sessionId === '..' || sessionId.includes('/') || sessionId.includes('\\')) {
        return { onDisk: false };
    }

    for (const projectDir of candidateProjectDirs(opts.workspacePath, opts.home)) {
        const sessionFile = join(projectDir, `${sessionId}.jsonl`);
        if (transcriptLooksValid(sessionFile)) {
            return { onDisk: true };
        }
        logger.debug(`[claudeCheckSession] Path ${sessionFile} does not exist or lacks uuid lines`);
    }

    // Cross-project: Claude --resume <uuid> searches every project drawer.
    const projectsRoot = claudeProjectsRoot(opts.home);
    try {
        for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const sessionFile = join(projectsRoot, entry.name, `${sessionId}.jsonl`);
            if (transcriptLooksValid(sessionFile)) {
                logger.debug(`[claudeCheckSession] Found ${sessionId} under cross-project drawer ${entry.name}`);
                return { onDisk: true };
            }
        }
    } catch {
        // projects root missing
    }

    return { onDisk: false };
}

export function claudeCheckSession(sessionId: string, path: string): boolean {
    return inspectClaudeTranscript({ sessionId, workspacePath: path }).onDisk;
}
