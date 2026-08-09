import chalk from 'chalk'
import { agyCommand } from './agy'
import { authCommand } from './auth'
import { claudeCommand } from './claude'
import { codexCommand } from './codex'
import { cursorCommand } from './cursor'
import { connectCommand } from './connect'
import { runnerCommand } from './runner'
import { resumeCommand } from './resume'
import { doctorCommand } from './doctor'
import { kimiCommand } from './kimi'
import { copilotCommand } from './copilot'
import { grokCommand } from './grok'
import { opencodeCommand } from './opencode'
import { piCommand } from './pi'
import { hookForwarderCommand } from './hookForwarder'
import { mcpCommand } from './mcp'
import { notifyCommand } from './notify'
import { hubCommand } from './hub'
import { pingPeerCommand } from './pingPeer'
import { inspectPeerCommand } from './inspectPeer'
import type { CommandContext, CommandDefinition } from './types'

// Gemini CLI was sunset (Google stopped serving the consumer Gemini CLI on
// 2026-06-18) so the agent is no longer launchable. Keep an explicit tombstone
// command so `hapi gemini` reports a clear error instead of falling through to
// the default Claude command with "gemini" as a forwarded argument.
const removedGeminiCommand: CommandDefinition = {
    name: 'gemini',
    requiresRuntimeAssets: false,
    run: async () => {
        console.error(
            chalk.red('Error:'),
            'Gemini CLI is no longer supported and cannot be launched (Google sunset the consumer Gemini CLI on 2026-06-18). Existing Gemini sessions remain viewable in the web UI.'
        )
        process.exit(1)
    }
}

const COMMANDS: CommandDefinition[] = [
    agyCommand,
    authCommand,
    connectCommand,
    codexCommand,
    cursorCommand,
    removedGeminiCommand,
    grokCommand,
    kimiCommand,
    copilotCommand,
    opencodeCommand,
    piCommand,
    mcpCommand,
    hubCommand,
    { ...hubCommand, name: 'server' },
    hookForwarderCommand,
    doctorCommand,
    resumeCommand,
    runnerCommand,
    notifyCommand,
    pingPeerCommand,
    inspectPeerCommand
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

/**
 * Lowercase kebab tokens look like HAPI subcommands (`auth`, `job`, `ping-peer`).
 * Flags (`--yolo`) and free-form Claude prompts stay on the default launcher.
 */
export function looksLikeCliSubcommand(token: string): boolean {
    return /^[a-z][a-z0-9-]*$/.test(token)
}

function unknownSubcommandCommand(name: string): CommandDefinition {
    return {
        name,
        requiresRuntimeAssets: false,
        run: async () => {
            console.error(chalk.red('Error:'), `Unknown hapi command '${name}'.`)
            console.error(`Run ${chalk.bold('hapi --help')} for supported commands.`)
            console.error(
                'If you expected this command after a hub upgrade, update the CLI (npm / Homebrew / GitHub release). A stale binary used to fall through to Claude and look like success.'
            )
            process.exit(1)
        }
    }
}

export function resolveCommand(args: string[]): { command: CommandDefinition; context: CommandContext } {
    const subcommand = args[0]
    const command = subcommand ? commandMap.get(subcommand) : undefined
    if (command) {
        return {
            command,
            context: {
                args,
                subcommand,
                commandArgs: args.slice(1)
            }
        }
    }

    // Do not Claude-passthrough unknown subcommand-shaped tokens (stale CLI footgun).
    if (subcommand && looksLikeCliSubcommand(subcommand)) {
        return {
            command: unknownSubcommandCommand(subcommand),
            context: {
                args,
                subcommand,
                commandArgs: args.slice(1)
            }
        }
    }

    return {
        command: claudeCommand,
        context: {
            args,
            subcommand,
            commandArgs: args
        }
    }
}
