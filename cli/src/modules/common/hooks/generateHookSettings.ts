import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import {
    hapiClaudePreToolUseGuardCommand,
    resolveHapiToolingRoot
} from '@/modules/common/hooks/resolveHapiToolingRoot';

// agy PreToolUse hooks block the agent until the user answers on their phone —
// which can take minutes. Give the PreToolUse hook a generous timeout so a
// human has time to respond.
const PRE_TOOL_USE_TIMEOUT_SECONDS = 3600;

type HookCommandConfig = {
    matcher?: string;
    hooks: Array<{
        type: 'command';
        command: string;
    }>;
};

type AgyHookEntry = {
    matcher: string;
    hooks: Array<{
        command: string;
        timeout?: number;
    }>;
};

type AgyHooksJson = {
    [hookName: string]: {
        PreToolUse: AgyHookEntry[];
    };
};

type HookSettings = {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
        UserPromptSubmit?: HookCommandConfig[];
        PreToolUse?: HookCommandConfig[];
    };
};

export type HookSettingsOptions = {
    filenamePrefix: string;
    logLabel: string;
    hooksEnabled?: boolean;
    /**
     * Also forward UserPromptSubmit and PreToolUse hooks. Unlike SessionStart,
     * their payloads carry `permission_mode`, letting HAPI track the mode the
     * user picks inside the interactive TUI (shift+tab). Keep this off for the
     * remote SDK process: these hooks block Claude while the forwarder runs,
     * and remote permission state is owned by the hub/RPC path anyway.
     */
    trackPermissionMode?: boolean;
    /** When set and cwd resolves to hapi, inject project-scoped PreToolUse guards. */
    workingDirectory?: string;
};

function shellQuote(value: string): string {
    if (value.length === 0) {
        return '""';
    }

    if (/^[A-Za-z0-9_\/:=-]+$/.test(value)) {
        return value;
    }

    return '"' + value.replace(/(["\\$`])/g, '\\$1') + '"';
}

function shellJoin(parts: string[]): string {
    return parts.map(shellQuote).join(' ');
}

/**
 * Build Claude Code hook settings.
 * Soup union: upstream trackPermissionMode (UserPromptSubmit + PreToolUse *) plus
 * fork workingDirectory PreToolUse Bash guard when cwd is under a hapi tree.
 */
export function buildHookSettings(
    command: string,
    hooksEnabled?: boolean,
    trackPermissionMode?: boolean,
    workingDirectory?: string
): HookSettings {
    const commandHook = {
        hooks: [
            {
                type: 'command' as const,
                command
            }
        ]
    };
    const hooks: HookSettings['hooks'] = {
        SessionStart: [{ matcher: '*', ...commandHook }]
    };
    if (trackPermissionMode) {
        hooks.UserPromptSubmit = [commandHook];
        hooks.PreToolUse = [{ matcher: '*', ...commandHook }];
    }

    const hapiRoot = workingDirectory ? resolveHapiToolingRoot(workingDirectory) : null;
    if (hapiRoot) {
        const guardCommand = hapiClaudePreToolUseGuardCommand(hapiRoot);
        if (existsSync(guardCommand)) {
            const guardEntry: HookCommandConfig = {
                matcher: 'Bash',
                hooks: [
                    {
                        type: 'command',
                        command: guardCommand
                    }
                ]
            };
            hooks.PreToolUse = [...(hooks.PreToolUse ?? []), guardEntry];
            logger.debug(`[generateHookSettings] HAPI PreToolUse guard: ${guardCommand}`);
        }
    }

    const settings: HookSettings = { hooks };
    if (hooksEnabled !== undefined) {
        settings.hooksConfig = {
            enabled: hooksEnabled
        };
    }

    return settings;
}

export function generateHookSettingsFile(
    port: number,
    token: string,
    options: HookSettingsOptions
): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `${options.filenamePrefix}-${process.pid}.json`;
    const filepath = join(hooksDir, filename);

    const { command, args } = getHappyCliCommand([
        'hook-forwarder',
        '--port',
        String(port),
        '--token',
        token
    ]);
    const hookCommand = shellJoin([command, ...args]);

    const settings = buildHookSettings(
        hookCommand,
        options.hooksEnabled,
        options.trackPermissionMode,
        options.workingDirectory
    );

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[${options.logLabel}] Created hook settings file: ${filepath}`);

    return filepath;
}

/**
 * Build the JSON string for agy's hooks.json. The returned string is suitable
 * for writing into a workspace-local .agents/hooks.json carrier.
 *
 * agy does not use a `type` field on hook entries (unlike claude which requires
 * `"type": "command"`). The timeout is in seconds; 3600 gives the user an hour
 * to answer a permission prompt on their phone.
 */
export function buildAgyHooksJson(command: string, hookName = 'hapi-bridge'): string {
    const content: AgyHooksJson = {
        [hookName]: {
            PreToolUse: [
                {
                    matcher: '*',
                    hooks: [{ command, timeout: PRE_TOOL_USE_TIMEOUT_SECONDS }]
                }
            ]
        }
    };
    return JSON.stringify(content, null, 4);
}

export function cleanupHookSettingsFile(filepath: string, logLabel: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
            logger.debug(`[${logLabel}] Cleaned up hook settings file: ${filepath}`);
        }
    } catch (error) {
        logger.debug(`[${logLabel}] Failed to cleanup hook settings file: ${error}`);
    }
}
