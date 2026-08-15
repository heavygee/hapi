import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { Hono } from 'hono'
import type { KitchenStatusResponse } from '@hapi/protocol/apiTypes'
import type { WebAppEnv } from '../middleware/auth'

const OWNER_ONLY_ERROR = 'Kitchen status is only available to the hub owner'

// Kitchen status describes this hub host's own fork/soup tree (mirror
// porcelain, driver head, remat hold) — it is meaningless for any other
// namespace's sessions, hence the same hub-owner gate as usage/hub-settings.
const SCRIPT_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 15_000

let cached: { at: number; value: KitchenStatusResponse } | null = null
let inFlight: Promise<KitchenStatusResponse> | null = null

function resolveScriptPath(): string {
    const primary = process.env.HAPI_PRIMARY?.trim() || path.join(homedir(), 'coding', 'hapi')
    return path.join(primary, 'scripts', 'tooling', 'hapi-kitchen-status.sh')
}

// The script's own exit code (0 green / 1 dirty / 75 busy / 76 hold) is a status
// signal, not a failure — only missing/unparseable stdout means the check itself
// could not run. Exported standalone so tests can cover it without mocking exec.
export function parseKitchenStatusOutput(stdout: string): KitchenStatusResponse {
    try {
        const parsed = JSON.parse(stdout.trim())
        return { ...parsed, available: true, checkedAt: Date.now() }
    } catch {
        return { available: false }
    }
}

async function runKitchenStatusScript(scriptPath: string): Promise<KitchenStatusResponse> {
    return await new Promise((resolve) => {
        execFile(
            'bash',
            [scriptPath, '--json'],
            { timeout: SCRIPT_TIMEOUT_MS },
            (_error, stdout) => {
                resolve(parseKitchenStatusOutput(stdout))
            }
        )
    })
}

async function getKitchenStatus(): Promise<KitchenStatusResponse> {
    const now = Date.now()
    if (cached && now - cached.at < CACHE_TTL_MS) {
        return cached.value
    }
    if (inFlight) {
        return await inFlight
    }

    const scriptPath = resolveScriptPath()
    if (!existsSync(scriptPath)) {
        const value: KitchenStatusResponse = { available: false }
        cached = { at: now, value }
        return value
    }

    inFlight = runKitchenStatusScript(scriptPath)
        .then((value) => {
            cached = { at: Date.now(), value }
            return value
        })
        .finally(() => {
            inFlight = null
        })
    return await inFlight
}

export function createKitchenStatusRoutes(
    options: { getStatus?: () => Promise<KitchenStatusResponse> } = {}
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const getStatus = options.getStatus ?? getKitchenStatus

    app.get('/kitchen-status', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        c.header('Cache-Control', 'no-store')
        const response = await getStatus()
        return c.json(response)
    })

    return app
}
