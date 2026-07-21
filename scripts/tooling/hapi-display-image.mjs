#!/usr/bin/env bun
/**
 * Post a local image inline to a HAPI session via the session CLI's display_image MCP tool.
 *
 * Uses session.metadata.hapiMcpUrl (published at MCP server start) so we hit the MCP
 * endpoint, not the session hook server on another loopback port in the same process.
 *
 * Usage:
 *   # one-shot from inside an agent session (self-targets the current session):
 *   bun scripts/tooling/hapi-display-image.mjs <image-path> [title]
 *   # explicit self:
 *   bun scripts/tooling/hapi-display-image.mjs self <image-path> [title]
 *   # explicit other session:
 *   bun scripts/tooling/hapi-display-image.mjs <session-id-prefix> <image-path> [title]
 *
 * Self-resolution matches session.metadata.agentSessionId against
 * $HAPI_AGENT_SESSION_ID (or $CURSOR_CONVERSATION_ID for Cursor-flavor agents),
 * both of which are present in the agent's shell env - no session id hunting.
 */

import { readFileSync, lstatSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const HAPI_HOST = process.env.HAPI_HOST ?? 'http://localhost:3006'
const SETTINGS = process.env.HAPI_SETTINGS ?? `${process.env.HOME}/.hapi/settings.json`

const SELF_TOKENS = new Set(['self', '@self', '@me', 'current', '-'])

function isFile(p) {
    try {
        return lstatSync(p).isFile()
    } catch {
        return false
    }
}

// Arg shapes (backward compatible):
//   <image> [title]                    → self-target current session
//   <self-token> <image> [title]       → self-target, explicit
//   <session-id-prefix> <image> [title]→ explicit session (original behavior)
const args = process.argv.slice(2)
let sessionArg
let imagePath
let title
if (args.length > 0 && isFile(args[0]) && !SELF_TOKENS.has(args[0])) {
    sessionArg = null
    imagePath = args[0]
    title = args[1]
} else {
    sessionArg = args[0]
    imagePath = args[1]
    title = args[2]
}

if (!imagePath) {
    console.error('usage: hapi-display-image.mjs [<session-id-prefix>|self] <image-path> [title]')
    process.exit(2)
}

if (!isFile(imagePath)) {
    console.error(`not a file: ${imagePath}`)
    process.exit(2)
}

const token = process.env.CLI_API_TOKEN ?? JSON.parse(readFileSync(SETTINGS, 'utf8')).cliApiToken
if (!token) {
    console.error('missing CLI_API_TOKEN env and no cliApiToken in settings')
    process.exit(2)
}
const authRes = await fetch(`${HAPI_HOST}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: token }),
})
if (!authRes.ok) {
    console.error('auth failed', authRes.status)
    process.exit(3)
}
const { token: jwt } = await authRes.json()

const sessionsRes = await fetch(`${HAPI_HOST}/api/sessions?limit=500`, {
    headers: { Authorization: `Bearer ${jwt}` },
})
const sessionsBody = await sessionsRes.json()
const sessions = sessionsBody.sessions ?? sessionsBody

let listed
if (!sessionArg || SELF_TOKENS.has(sessionArg)) {
    // Self-target: resolve the current agent's session from env, no id hunting.
    const agentSessionId = process.env.HAPI_AGENT_SESSION_ID ?? process.env.CURSOR_CONVERSATION_ID
    if (!agentSessionId) {
        console.error(
            'cannot self-resolve session: no $HAPI_AGENT_SESSION_ID or $CURSOR_CONVERSATION_ID in env. '
            + 'Pass an explicit <session-id-prefix>.',
        )
        process.exit(4)
    }
    listed = sessions.find((s) => s.metadata?.agentSessionId === agentSessionId)
    if (!listed) {
        console.error(`no session with metadata.agentSessionId=${agentSessionId}`)
        process.exit(4)
    }
} else {
    listed = sessions.find((s) => s.id.startsWith(sessionArg))
    if (!listed) {
        console.error(`no session for prefix ${sessionArg}`)
        process.exit(4)
    }
}

// List endpoint omits hapiMcpUrl; fetch full session for MCP bridge URL.
let mcpUrl = listed.metadata?.hapiMcpUrl
if (!mcpUrl) {
    const detailRes = await fetch(`${HAPI_HOST}/api/sessions/${listed.id}`, {
        headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!detailRes.ok) {
        console.error('session detail fetch failed', detailRes.status)
        process.exit(4)
    }
    const detailBody = await detailRes.json()
    const detail = detailBody.session ?? detailBody
    mcpUrl = detail.metadata?.hapiMcpUrl
}
if (!mcpUrl) {
    console.error('session has no hapiMcpUrl metadata (restart session CLI after MCP fix lands)')
    process.exit(5)
}

console.error(`hapi-display-image: session=${listed.id} mcp=${mcpUrl}`)

const client = new Client({ name: 'hapi-display-image', version: '1.0.0' }, { capabilities: {} })
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl))
await client.connect(transport)
const result = await client.callTool({
    name: 'display_image',
    arguments: { path: imagePath, title: title ?? undefined },
})
await client.close()
console.log(JSON.stringify(result, null, 2))
