#!/usr/bin/env node
/**
 * Run Playwright against an isolated peer stack (real hub + web/dist session UI).
 *
 * Usage:
 *   node scripts/dev/run-e2e-on-peer-stack.mjs [playwright-args...]
 *   node scripts/dev/run-e2e-on-peer-stack.mjs --keep e2e/scratchlist-exit-after-queue-peer.spec.ts
 *   node scripts/dev/run-e2e-on-peer-stack.mjs --worktree PATH --name NAME ...
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

function loadEnvFile(path) {
    if (!existsSync(path)) return {}
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq)
        const val = trimmed.slice(eq + 1)
        out[key] = val
        if (!(key in process.env)) process.env[key] = val
    }
    return out
}

function parseArgs(argv) {
    const playwrightArgs = []
    let keep = false
    let stackName = ''
    let worktree = process.cwd()
    let noUp = false
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--keep') { keep = true; continue }
        if (arg === '--no-up') { noUp = true; continue }
        if (arg === '--name') { stackName = argv[++i] ?? ''; continue }
        if (arg === '--worktree') { worktree = argv[++i] ?? worktree; continue }
        playwrightArgs.push(arg)
    }
    return { playwrightArgs, keep, stackName, worktree, noUp }
}

function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts })
    if (res.status !== 0) process.exit(res.status ?? 1)
}

const { playwrightArgs, keep, stackName, worktree, noUp } = parseArgs(process.argv)
const envPath = resolve(worktree, 'localdocs/peer-stack.env')
loadEnvFile(envPath)

const peerStack = resolve(repoRoot, 'scripts/tooling/hapi-peer-stack.sh')
let startedHere = false

if (!noUp && !process.env.HAPI_PEER_WEB_URL) {
    const upArgs = ['up', '--worktree', worktree]
    if (stackName) upArgs.push('--name', stackName)
    run('bash', [peerStack, ...upArgs], { cwd: worktree })
    loadEnvFile(envPath)
    startedHere = true
}

if (!process.env.HAPI_PEER_WEB_URL) {
    console.error('HAPI_PEER_WEB_URL missing after peer stack up')
    process.exit(2)
}

process.env.HAPI_PEER_RECORD_VIDEO = process.env.HAPI_PEER_RECORD_VIDEO ?? '1'

try {
    run('bunx', ['playwright', 'test', ...playwrightArgs], { env: process.env })
} finally {
    if (startedHere && !keep && !process.env.HAPI_PEER_KEEP) {
        const name = process.env.HAPI_PEER_STACK_NAME ?? stackName
        if (name) {
            run('bash', [peerStack, 'down', '--name', name])
        }
    }
}
