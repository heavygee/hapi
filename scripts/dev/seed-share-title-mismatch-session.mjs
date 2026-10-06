#!/usr/bin/env node
/**
 * Seed an active peer-stack session with mismatched name vs summary
 * (sidebar name ≠ share picker summary under the buggy /share helper).
 *
 * Usage:
 *   node scripts/dev/seed-share-title-mismatch-session.mjs \
 *     --hub-url http://127.0.0.1:3105 --token <CLI_API_TOKEN>
 *
 * Prints JSON: { sessionId, name, summary }
 */
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '../../cli/')
const { io } = await import(
    pathToFileURL(resolve(cliRoot, 'node_modules/socket.io-client/build/esm/index.js')).href
)

const SIDEBAR_NAME = 'hub runner version governance'
const SUMMARY_TEXT = 'HAPI Skill Lookup'

function parseArgs(argv) {
    const out = { hubUrl: '', token: '' }
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--hub-url') out.hubUrl = argv[++i]?.replace(/\/$/, '') ?? ''
        else if (arg === '--token') out.token = argv[++i] ?? ''
        else if (arg === '-h' || arg === '--help') {
            console.error('usage: seed-share-title-mismatch-session.mjs --hub-url URL --token TOKEN')
            process.exit(2)
        }
    }
    if (!out.hubUrl || !out.token) {
        console.error('usage: seed-share-title-mismatch-session.mjs --hub-url URL --token TOKEN')
        process.exit(2)
    }
    return out
}

async function createSession(hubUrl, token) {
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag: `share-title-parity-${Date.now()}`,
            metadata: {
                path: '/tmp/share-title-parity',
                host: hostname(),
                flavor: 'cursor',
                name: SIDEBAR_NAME,
                summary: { text: SUMMARY_TEXT, updatedAt: Date.now() },
            },
            agentState: { requests: {}, completedRequests: {} },
        }),
    })
    if (!res.ok) {
        throw new Error(`POST /cli/sessions failed (${res.status}): ${await res.text()}`)
    }
    const data = await res.json()
    const sessionId = data?.session?.id
    if (!sessionId) {
        throw new Error(`unexpected /cli/sessions response: ${JSON.stringify(data)}`)
    }
    return sessionId
}

async function activateSession(hubUrl, token, sessionId) {
    await new Promise((resolvePromise, reject) => {
        const socket = io(`${hubUrl}/cli`, {
            transports: ['websocket'],
            auth: { token, sessionId },
            reconnection: false,
            timeout: 15_000,
        })
        const fail = (err) => {
            socket.close()
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        socket.on('connect_error', fail)
        socket.on('error', (payload) => fail(new Error(JSON.stringify(payload))))
        socket.on('connect', () => {
            socket.emit('session-alive', {
                sid: sessionId,
                time: Date.now(),
                thinking: false,
                mode: 'remote',
            })
            socket.emit('session-ready', {
                sid: sessionId,
                time: Date.now(),
            })
            setTimeout(() => {
                socket.close()
                resolvePromise(undefined)
            }, 500)
        })
    })
}

const args = parseArgs(process.argv)

try {
    const sessionId = await createSession(args.hubUrl, args.token)
    await activateSession(args.hubUrl, args.token, sessionId)
    console.log(JSON.stringify({
        sessionId,
        name: SIDEBAR_NAME,
        summary: SUMMARY_TEXT,
        hubUrl: args.hubUrl,
    }))
} catch (error) {
    console.error(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
}
