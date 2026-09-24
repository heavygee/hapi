#!/usr/bin/env bun

import { runCli } from './commands/runCli'

try {
    await runCli()
} catch (error) {
    // Commands normally call process.exit themselves; this is the backstop when
    // a command throws (or when process.exit is mocked in tests). Never let an
    // unhandled rejection fall through as exit 0 — that is the silent-success
    // class that made expired JWTs look like "no matches".
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    const code = typeof process.exitCode === 'number' && process.exitCode !== 0
        ? process.exitCode
        : 1
    process.exit(code)
}
