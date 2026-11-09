#!/usr/bin/env bun

import { handleDisclaimExecEntry, takeDisclaimFallbackNote } from './runtime/disclaimExec'

async function main(): Promise<void> {
    // Before the CLI module graph loads: the macOS responsibility re-exec must
    // happen before any module side effects.
    await handleDisclaimExecEntry()
    const fallbackNote = takeDisclaimFallbackNote()
    // Dependency-free, so `--help` and `--version` work even when HAPI_HOME cannot be created.
    const { captureLauncherPid } = await import('./runtime/launcherPid')
    captureLauncherPid()
    const { runCli } = await import('./commands/runCli')
    if (fallbackNote) {
        try {
            // The logger creates HAPI_HOME; the note is best effort.
            const { logger } = await import('./ui/logger')
            logger.debug(`[WARN] [DISCLAIM] ${fallbackNote}`)
        } catch {
            // The note already went to stderr when the disclaim failed.
        }
    }
    try {
        await runCli()
    } catch (error) {
        // Fork backstop preserved across upstream's main() restructure: an
        // unhandled rejection would otherwise fall through as exit 0.
        const message = error instanceof Error ? error.message : String(error)
        console.error(message)
        const code = typeof process.exitCode === 'number' && process.exitCode !== 0 ? process.exitCode : 1
        process.exit(code)
    }
}

void main()
