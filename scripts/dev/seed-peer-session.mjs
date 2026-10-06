#!/usr/bin/env node
/**
 * Seed a minimal active session on a peer stack hub for Playwright.
 *
 * Usage:
 *   node scripts/dev/seed-peer-session.mjs --hub-url http://127.0.0.1:3107 --token <CLI_API_TOKEN>
 *
 * Prints JSON: { sessionId, webAccessToken, hubUrl }
 */
import { hostname } from 'node:os'

function parseArgs(argv) {
    const out = { hubUrl: '', token: '', title: 'Peer stack session' }
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--hub-url') out.hubUrl = argv[++i]?.replace(/\/$/, '') ?? ''
        else if (arg === '--token') out.token = argv[++i] ?? ''
        else if (arg === '--title') out.title = argv[++i] ?? out.title
        else if (arg === '-h' || arg === '--help') {
            console.error('usage: seed-peer-session.mjs --hub-url URL --token TOKEN [--title TITLE]')
            process.exit(2)
        }
    }
    if (!out.hubUrl || !out.token) {
        console.error('usage: seed-peer-session.mjs --hub-url URL --token TOKEN [--title TITLE]')
        process.exit(2)
    }
    return out
}

async function createSession(hubUrl, token, title) {
    const tag = `peer-${Date.now()}`
    const res = await fetch(`${hubUrl}/cli/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tag,
            metadata: {
                path: process.cwd(),
                host: hostname(),
                flavor: 'cursor',
                name: title,
            },
            agentState: { requests: {}, completedRequests: {} },
        }),
    })
    if (!res.ok) {
        const body = await res.text()
        throw new Error(`POST /cli/sessions failed (${res.status}): ${body}`)
    }
    const data = await res.json()
    const sessionId = data?.session?.id
    if (!sessionId) {
        throw new Error(`unexpected /cli/sessions response: ${JSON.stringify(data)}`)
    }
    return sessionId
}

async function activateSession(hubUrl, token, sessionId) {
    const cliRoot = new URL('../../cli/', import.meta.url)
    const { io } = await import(new URL('node_modules/socket.io-client/build/esm/index.js', cliRoot).href)
    await new Promise((resolve, reject) => {
        const socket = io(`${hubUrl}/cli`, {
            transports: ['websocket'],
            auth: { token, sessionId },
            reconnection: false,
            timeout: 15000,
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
                resolve(undefined)
            }, 500)
        })
    })
}

const args = parseArgs(process.argv)

try {
    const sessionId = await createSession(args.hubUrl, args.token, args.title)
    await activateSession(args.hubUrl, args.token, sessionId)
    console.log(JSON.stringify({
        sessionId,
        webAccessToken: args.token,
        hubUrl: args.hubUrl,
    }))
} catch (error) {
    console.error(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
}
