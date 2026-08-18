import { configuration } from '@/configuration'
import { isBunCompiled } from '@/projectPath'
import { readSettings } from '@/persistence'
import { readUpgradeTarget } from '@/upgrade/upgradeTarget'
import { initializeApiUrl } from '@/ui/apiUrlInit'
import packageJson from '../../package.json'
import { formatVersionIdentity } from './versionIdentity'
import type { CommandDefinition } from './types'

const HUB_LOOKUP_MS = 2_000

export function currentCliExecutable(): string {
    if (process.env.HAPI_CLI_EXECUTABLE) {
        return process.env.HAPI_CLI_EXECUTABLE
    }
    if (isBunCompiled()) {
        return process.execPath
    }
    return process.argv[1] || process.execPath
}

export async function fetchHubTargetGeneration(deps: {
    apiUrl?: string
    accessToken?: string
    fetchImpl?: typeof fetch
    timeoutMs?: number
} = {}): Promise<string | null> {
    const fetchImpl = deps.fetchImpl ?? fetch
    const timeoutMs = deps.timeoutMs ?? HUB_LOOKUP_MS
    const apiUrl = (deps.apiUrl ?? configuration.apiUrl).trim().replace(/\/+$/, '')
    const accessToken = (deps.accessToken ?? '').trim()
    if (!apiUrl || !accessToken) {
        return null
    }
    try {
        const auth = await fetchImpl(`${apiUrl}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken }),
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!auth.ok) {
            return null
        }
        const authBody = await auth.json() as { token?: unknown }
        if (typeof authBody.token !== 'string' || authBody.token.length === 0) {
            return null
        }
        const offerRes = await fetchImpl(`${apiUrl}/api/upgrade/offer`, {
            headers: { Authorization: `Bearer ${authBody.token}` },
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!offerRes.ok) {
            return null
        }
        const body = await offerRes.json() as { offer?: { targetGeneration?: unknown } }
        return typeof body.offer?.targetGeneration === 'string' && body.offer.targetGeneration.length > 0
            ? body.offer.targetGeneration
            : null
    } catch {
        return null
    }
}

async function resolveAccessToken(): Promise<string> {
    if (configuration.cliApiToken) {
        return configuration.cliApiToken
    }
    try {
        const settings = await readSettings()
        if (typeof settings.cliApiToken === 'string' && settings.cliApiToken.length > 0) {
            configuration._setCliApiToken(settings.cliApiToken)
            return settings.cliApiToken
        }
    } catch {
        // offline / unreadable settings
    }
    return ''
}

export const versionCommand: CommandDefinition = {
    name: 'version',
    requiresRuntimeAssets: false,
    run: async () => {
        await initializeApiUrl().catch(() => undefined)
        const accessToken = await resolveAccessToken()
        const marker = readUpgradeTarget()
        const hubTarget = await fetchHubTargetGeneration({ accessToken })
        console.log(formatVersionIdentity({
            version: packageJson.version,
            generation: marker?.targetGeneration ?? null,
            hubTarget,
            executable: currentCliExecutable(),
            durableTarget: marker?.path ?? null,
        }).trimEnd())
        process.exit(0)
    },
}
