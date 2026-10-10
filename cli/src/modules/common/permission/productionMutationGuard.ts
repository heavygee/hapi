/**
 * Block production HAPI mutations from agent shell (manual hub, stack switch, :3006 kill).
 * Shared by CLI PermissionAdapter (HAPI ACP/yolo path) and operator hook scripts.
 */

const MUTATION_PATTERNS: RegExp[] = [
    /hapi-driver-db-prep/,
    /hapi-use-worktree/,
    /hapi-use-driver/,
    /hapi-driver-rebuild.*--activate/,
    /hapi-watch-activate-driver/,
    /hapi_stack_switch_yes=1/,
    /nohup.*(bun run|src\/index\.ts)/,
    /manual-hub/,
    /(^|[\s;|&])(kill|pkill|fuser)[\s].*(3006|hapi-hub|\/hub\/|src\/index\.ts)/,
    /systemctl[\s]+(stop|restart|kill|disable|mask)[\s]+hapi-(hub|runner|runner-watchdog)/,
    /git reset --hard.*(driver|hapi\/driver)/,
    /embeddedassets.*driver/,
    /(\.hapi\/hapi\.db|hapi\.db\.bak)/,
];

const REMOTE_SSH_PATTERN = /(^|[\s|&;])(ssh|scp|rsync)[\s]|wsl[\s].*ssh/;

export function extractShellCommandLine(input: {
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
}): string {
    if (typeof input.title === 'string' && input.title.trim()) {
        return input.title.trim();
    }
    if (input.rawInput && typeof input.rawInput === 'object') {
        const raw = input.rawInput as Record<string, unknown>;
        for (const key of ['command', 'cmd', 'script']) {
            const value = raw[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }
    return '';
}

export function matchesProductionMutation(command: string): boolean {
    if (!command.trim()) {
        return false;
    }
    const lc = command.toLowerCase();
    return MUTATION_PATTERNS.some((re) => re.test(lc));
}

export function matchesRemoteProductionMutation(command: string): boolean {
    if (!command.trim()) {
        return false;
    }
    const lc = command.toLowerCase();
    return REMOTE_SSH_PATTERN.test(lc) && matchesProductionMutation(command);
}

export function shouldDenyAgentShellCommand(input: {
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
}): { deny: boolean; command: string; reason?: string } {
    const command = extractShellCommandLine(input);
    if (!command) {
        return { deny: false, command: '' };
    }

    const lcKind = (input.kind ?? '').toLowerCase();
    const looksLikeShell =
        lcKind === 'execute' ||
        lcKind === 'shell' ||
        lcKind === 'run_terminal_cmd' ||
        /^(ssh|curl|git|kill|nohup|hapi-|sudo|systemctl)\b/i.test(command);

    if (!looksLikeShell && !matchesProductionMutation(command)) {
        return { deny: false, command };
    }

    if (matchesProductionMutation(command)) {
        return {
            deny: true,
            command,
            reason: matchesRemoteProductionMutation(command)
                ? 'Production HAPI mutation over SSH blocked (Windows estate muzzle).'
                : 'Production HAPI mutation blocked (manual hub / stack switch / :3006).',
        };
    }

    return { deny: false, command };
}
