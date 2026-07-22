/**
 * Resolve CLI API token + JWT for the live hub (driver :3006 or peer).
 *
 * Why this exists: oos-linux soup hub uses HAPI_HOME=/var/lib/hapi, while almost
 * every doc/script still defaults to ~/.hapi/settings.json. Agents then get 401
 * and invent auth for 20 minutes. Kill that class of failure here.
 *
 * Resolution order for settings.json:
 *   1. $HAPI_SETTINGS (explicit file)
 *   2. $HAPI_HOME/settings.json
 *   3. settings.json next to the live hub process listening on the hub port
 *      (reads /proc/<pid>/environ for HAPI_HOME)
 *   4. /var/lib/hapi/settings.json (oos-linux soup default)
 *   5. ~/.hapi/settings.json
 *
 * Token override: $HAPI_CLI_TOKEN or $CLI_API_TOKEN wins over the file.
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

function tryReadJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
        return null
    }
}

function hubPortFromUrl(hubUrl) {
    try {
        const u = new URL(hubUrl)
        if (u.port) return Number(u.port)
        return u.protocol === 'https:' ? 443 : 80
    } catch {
        return 3006
    }
}

/** Best-effort: find HAPI_HOME of the process listening on hub port. */
export function detectLiveHubHome(hubUrl) {
    const port = hubPortFromUrl(hubUrl)
    try {
        const out = execSync(`ss -ltnp 2>/dev/null | grep ':${port} ' || true`, {
            encoding: 'utf8',
            shell: '/bin/bash',
        })
        const m = out.match(/pid=(\d+)/)
        if (!m) return null
        const environ = readFileSync(`/proc/${m[1]}/environ`, 'utf8')
        const hit = environ.split('\0').find((e) => e.startsWith('HAPI_HOME='))
        return hit ? hit.slice('HAPI_HOME='.length) : null
    } catch {
        return null
    }
}

export function resolveSettingsPath(hubUrl = 'http://127.0.0.1:3006') {
    if (process.env.HAPI_SETTINGS && existsSync(process.env.HAPI_SETTINGS)) {
        return process.env.HAPI_SETTINGS
    }
    if (process.env.HAPI_HOME) {
        const p = `${process.env.HAPI_HOME.replace(/^~/, homedir())}/settings.json`
        if (existsSync(p)) return p
    }
    const liveHome = detectLiveHubHome(hubUrl)
    if (liveHome) {
        const p = `${liveHome}/settings.json`
        if (existsSync(p)) return p
    }
    for (const p of [`/var/lib/hapi/settings.json`, `${homedir()}/.hapi/settings.json`]) {
        if (existsSync(p)) return p
    }
    return null
}

export function loadCliApiToken(hubUrl = 'http://127.0.0.1:3006') {
    if (process.env.HAPI_CLI_TOKEN) return { token: process.env.HAPI_CLI_TOKEN, source: 'env:HAPI_CLI_TOKEN' }
    if (process.env.CLI_API_TOKEN) return { token: process.env.CLI_API_TOKEN, source: 'env:CLI_API_TOKEN' }
    const path = resolveSettingsPath(hubUrl)
    if (!path) {
        throw new Error(
            'No CLI API token: set HAPI_CLI_TOKEN, or ensure settings.json exists under '
            + 'live hub HAPI_HOME / /var/lib/hapi / ~/.hapi (see scripts/tooling/lib/hapi-hub-auth.mjs)'
        )
    }
    const settings = tryReadJson(path)
    if (!settings?.cliApiToken) {
        throw new Error(`settings.json at ${path} has no cliApiToken`)
    }
    return { token: settings.cliApiToken, source: path }
}

export async function fetchWebJwt(hubUrl, cliApiToken) {
    const base = hubUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: cliApiToken }),
    })
    if (!res.ok) {
        throw new Error(`POST ${base}/api/auth failed (${res.status}): ${await res.text()}`)
    }
    const body = await res.json()
    if (!body?.token) throw new Error(`auth response missing token: ${JSON.stringify(body)}`)
    return body.token
}

/** Full auth bundle for Playwright + REST. */
export async function resolveHubAuth(hubUrl = process.env.HAPI_HUB_URL ?? process.env.HAPI_HOST ?? 'http://127.0.0.1:3006') {
    const base = hubUrl.replace(/\/$/, '')
    const { token: cliApiToken, source } = loadCliApiToken(base)
    const jwt = await fetchWebJwt(base, cliApiToken)
    return { hubUrl: base, cliApiToken, jwt, tokenSource: source }
}
