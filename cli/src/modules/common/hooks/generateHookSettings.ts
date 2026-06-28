import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import {
    hapiClaudePreToolUseGuardCommand,
    resolveHapiToolingRoot
} from '@/modules/common/hooks/resolveHapiToolingRoot';

type HookCommandConfig = {
    matcher: string;
    hooks: Array<{
        type: 'command';
        command: string;
    }>;
};

type HookSettings = {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
        PreToolUse?: HookCommandConfig[];
    };
};

export type HookSettingsOptions = {
    filenamePrefix: string;
    logLabel: string;
    hooksEnabled?: boolean;
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

function buildHookSettings(
    sessionStartCommand: string,
    options: Pick<HookSettingsOptions, 'hooksEnabled' | 'workingDirectory'>
): HookSettings {
    const hooks: HookSettings['hooks'] = {
        SessionStart: [
            {
                matcher: '*',
                hooks: [
                    {
                        type: 'command',
                        command: sessionStartCommand
                    }
                ]
            }
        ]
    };

    const hapiRoot = options.workingDirectory
        ? resolveHapiToolingRoot(options.workingDirectory)
        : null;
    if (hapiRoot) {
        const guardCommand = hapiClaudePreToolUseGuardCommand(hapiRoot);
        if (existsSync(guardCommand)) {
            hooks.PreToolUse = [
                {
                    matcher: 'Bash',
                    hooks: [
                        {
                            type: 'command',
                            command: guardCommand
                        }
                    ]
                }
            ];
            logger.debug(`[generateHookSettings] HAPI PreToolUse guard: ${guardCommand}`);
        }
    }

    const settings: HookSettings = { hooks };
    if (options.hooksEnabled !== undefined) {
        settings.hooksConfig = {
            enabled: options.hooksEnabled
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

    const settings = buildHookSettings(hookCommand, options);

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[${options.logLabel}] Created hook settings file: ${filepath}`);

    return filepath;
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
