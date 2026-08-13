import chalk from 'chalk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { parseDisplayLinksInput } from '@hapi/protocol'
import { getAuthToken } from '@/api/auth'
import { configuration } from '@/configuration'
import { initializeToken } from '@/ui/tokenInit'
import type { CommandDefinition } from './types'

const SELF_TOKENS = new Set(['self', '@self', '@me', 'current', '-'])
const LOCAL_SESSION_ONLY_ERROR =
    'display-links only supports the current local session; run it on the target runner'

/**
 * hapiMcpUrl is loopback on the owning CLI. Opening it for another hub session
 * hits the caller host (wrong server / coincident port). Self tokens and the
 * current $HAPI_SESSION_ID (full id or prefix) are the only safe targets.
 */
export function assertLocalDisplayLinksTarget(
    sessionArg: string | null,
    selfSessionId: string = process.env.HAPI_SESSION_ID?.trim() ?? ''
): void {
    if (!sessionArg || SELF_TOKENS.has(sessionArg)) {
        return
    }
    if (selfSessionId && (sessionArg === selfSessionId || selfSessionId.startsWith(sessionArg))) {
        return
    }
    throw new Error(LOCAL_SESSION_ONLY_ERROR)
}

type ParsedDisplayLinksArgs = {
    help: boolean
    sessionArg: string | null
    href: string
    title?: string
}

export function parseDisplayLinksArgs(args: string[]): ParsedDisplayLinksArgs {
    if (args.includes('--help') || args.includes('-h')) {
        return { help: true, sessionArg: null, href: '' }
    }
    if (args.length === 0) {
        throw new Error('missing href; usage: hapi display-links [<session>|self] <href> [title]')
    }

    const firstLooksLikeHref = /^https?:\/\//i.test(args[0] ?? '')
    if (firstLooksLikeHref) {
        return {
            help: false,
            sessionArg: null,
            href: args[0]!,
            title: args[1],
        }
    }

    if (args.length < 2) {
        throw new Error('missing href; usage: hapi display-links [<session>|self] <href> [title]')
    }

    return {
        help: false,
        sessionArg: args[0] ?? null,
        href: args[1]!,
        title: args[2],
    }
}

function showHelp(): void {
    console.log(`
${chalk.bold('hapi display-links')} - Paint tappable http(s) URL cards into a HAPI session

${chalk.bold('Usage:')}
  hapi display-links <href> [title]
  hapi display-links self <href> [title]

${chalk.bold('Notes:')}
  Uses this process's session MCP bridge (loopback hapiMcpUrl). Does not create a user turn.
  Other-session / cross-runner targeting is refused — run the command on the runner that owns the session.
  Construct landmine hosts by concatenation in the calling script ("tia"+"nn"), never from model prose.
  http/https only. javascript/data/vbscript/file are rejected.

${chalk.bold('Env:')}
  HAPI_SESSION_ID (self-target), HAPI_API_URL / CLI_API_TOKEN
`)
}

function sessionMatchesPrefix(session: { id?: string; metadata?: Record<string, unknown> }, prefix: string): boolean {
    if (typeof session.id === 'string' && session.id.startsWith(prefix)) return true
    const meta = session.metadata ?? {}
    const agentIds = [
        meta.agentSessionId,
        meta.cursorSessionId,
        meta.codexSessionId,
        meta.claudeSessionId,
        meta.geminiSessionId,
        meta.opencodeSessionId,
        meta.kimiSessionId,
    ]
    return agentIds.some((id) => typeof id === 'string' && id.startsWith(prefix))
}

async function authHeaders(): Promise<Record<string, string>> {
    const accessToken = getAuthToken()
    const authRes = await fetch(`${configuration.apiUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    })
    if (!authRes.ok) {
        throw new Error(`auth failed (${authRes.status})`)
    }
    const body = await authRes.json() as { token?: string }
    if (!body.token) {
        throw new Error('auth failed (missing JWT)')
    }
    return { Authorization: `Bearer ${body.token}` }
}

async function fetchSessionDetail(sessionId: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${configuration.apiUrl}/api/sessions/${encodeURIComponent(sessionId)}`, { headers })
    if (!res.ok) return null
    const body = await res.json() as { session?: Record<string, unknown> } & Record<string, unknown>
    return body.session ?? body
}

async function resolveSession(
    sessionArg: string | null,
    headers: Record<string, string>
): Promise<Record<string, unknown>> {
    const wantsSelf = !sessionArg || SELF_TOKENS.has(sessionArg)
    const hapiSessionId = process.env.HAPI_SESSION_ID?.trim()

    if (wantsSelf) {
        if (!hapiSessionId) {
            throw new Error(
                'cannot self-resolve session: $HAPI_SESSION_ID is not set. '
                + 'Pass an explicit <session-id-prefix>, or run inside a HAPI-wrapped agent session.'
            )
        }
        const session = await fetchSessionDetail(hapiSessionId, headers)
        if (!session) {
            throw new Error(`GET /api/sessions/${hapiSessionId} failed (HAPI_SESSION_ID set but hub has no such row)`)
        }
        return session
    }

    const looksFull = /^[0-9a-f-]{36}$/i.test(sessionArg)
    if (looksFull) {
        const session = await fetchSessionDetail(sessionArg, headers)
        if (session) return session
    }

    const listRes = await fetch(`${configuration.apiUrl}/api/sessions?limit=500`, { headers })
    const listBody = await listRes.json() as { sessions?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const sessions = Array.isArray(listBody) ? listBody : (listBody.sessions ?? [])
    const matches = sessions.filter((candidate) => sessionMatchesPrefix(candidate, sessionArg))
    if (matches.length !== 1) {
        throw new Error(
            matches.length === 0
                ? `no session for prefix ${sessionArg}`
                : `ambiguous session prefix ${sessionArg} (${matches.length} matches)`
        )
    }
    const listed = matches[0]!
    const id = typeof listed.id === 'string' ? listed.id : sessionArg
    return await fetchSessionDetail(id, headers) ?? listed
}

export async function handleDisplayLinksCommand(args: string[]): Promise<void> {
    const parsed = parseDisplayLinksArgs(args)
    if (parsed.help) {
        showHelp()
        return
    }

    const urls = parseDisplayLinksInput(
        parsed.title ? [{ href: parsed.href, title: parsed.title }] : [{ href: parsed.href }]
    )

    assertLocalDisplayLinksTarget(parsed.sessionArg)

    await initializeToken()
    const headers = await authHeaders()
    const session = await resolveSession(parsed.sessionArg, headers)
    const metadata = session.metadata && typeof session.metadata === 'object'
        ? session.metadata as Record<string, unknown>
        : {}
    const mcpUrl = typeof metadata.hapiMcpUrl === 'string' ? metadata.hapiMcpUrl : null
    if (!mcpUrl) {
        throw new Error('session has no hapiMcpUrl metadata (restart session CLI after MCP server start)')
    }

    const sessionId = typeof session.id === 'string' ? session.id : 'unknown'
    console.error(`hapi display-links: session=${sessionId} mcp=${mcpUrl}`)

    const client = new Client({ name: 'hapi-display-links', version: '1.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl))
    await client.connect(transport)
    try {
        const result = await client.callTool({
            name: 'display_links',
            arguments: { urls },
        })
        console.log(JSON.stringify(result, null, 2))
    } finally {
        await client.close()
    }
}

export const displayLinksCommand: CommandDefinition = {
    name: 'display-links',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await handleDisplayLinksCommand(commandArgs)
        } catch (error) {
            console.error(
                chalk.red('hapi display-links:'),
                error instanceof Error ? error.message : 'Unknown error'
            )
            process.exit(1)
        }
    }
}
