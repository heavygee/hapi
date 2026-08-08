#!/usr/bin/env bun
/**
 * Unit check: verify-happycomposer-bindings fails closed on unbound restoredIntent.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./verify-happycomposer-bindings.mjs', import.meta.url))
const bun = process.env.BUN ?? `${process.env.HOME}/.bun/bin/bun`

function runAgainst(fixtureRoot) {
    return spawnSync(bun, ['run', script, fixtureRoot], { encoding: 'utf8' })
}

const root = mkdtempSync(join(tmpdir(), 'happycomposer-bindings-'))
try {
    const happyDir = join(root, 'web/src/components/AssistantChat')
    mkdirSync(happyDir, { recursive: true })
    mkdirSync(join(root, 'web/src/components'), { recursive: true })

    // Broken: consume without declaration (the 2026-08-08 tip-forward miss).
    writeFileSync(
        join(happyDir, 'HappyComposer.tsx'),
        `
export function HappyComposer() {
    const handleSend = async () => {
        const effectiveIntent = pendingSchedule == null ? restoredIntent : 'default'
        void effectiveIntent
    }
}
`,
    )
    writeFileSync(
        join(root, 'web/src/components/SessionChat.tsx'),
        `export function SessionChat() { return null }\n`,
    )

    const bad = runAgainst(root)
    if (bad.status === 0) {
        console.error('expected FAIL on unbound restoredIntent, got OK')
        console.error(bad.stdout, bad.stderr)
        process.exit(1)
    }
    if (!String(bad.stderr).includes('restoredIntent')) {
        console.error('expected stderr to mention restoredIntent')
        console.error(bad.stderr)
        process.exit(1)
    }

    // Fixed: declaration present.
    writeFileSync(
        join(happyDir, 'HappyComposer.tsx'),
        `
export function HappyComposer() {
    const handleSend = async (intent = 'default') => {
        const restoredIntent = intent === 'default' ? 'default' : intent
        const effectiveIntent = pendingSchedule == null ? restoredIntent : 'default'
        void effectiveIntent
    }
}
`,
    )
    const good = runAgainst(root)
    if (good.status !== 0) {
        console.error('expected OK on bound restoredIntent')
        console.error(good.stdout, good.stderr)
        process.exit(1)
    }

    console.log('verify-happycomposer-bindings.test: OK')
} finally {
    rmSync(root, { recursive: true, force: true })
}
