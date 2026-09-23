import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'

/**
 * Exchange probe: true when the hub accepts this access token.
 * Used to ignore inherited stale CLI_API_TOKEN in agent shells while keeping
 * intentional `CLI_API_TOKEN=...` overrides when they still authenticate.
 */
export async function probeCliApiToken(apiUrl: string, accessToken: string): Promise<boolean> {
    const base = apiUrl.trim().replace(/\/+$/, '')
    const token = accessToken.trim()
    if (!base || !token) {
        return false
    }

    try {
        const response = await fetch(`${base}/api/auth`, {
            method: 'POST',
            headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ accessToken: token }),
            signal: AbortSignal.timeout(5_000)
        })
        if (!response.ok) {
            return false
        }
        const data = await response.json() as { token?: unknown }
        return typeof data.token === 'string' && data.token.length > 0
    } catch {
        return false
    }
}

/**
 * Pick env vs settings token when both are present. Env wins when it
 * authenticates; otherwise fall back to settings (fixes stale IDE inheritance).
 */
export async function reconcileCliApiToken(
    apiUrl: string,
    envToken: string,
    settingsToken?: string
): Promise<string> {
    const env = envToken.trim()
    const settings = settingsToken?.trim() ?? ''
    if (!env) {
        return settings
    }
    if (!settings || settings === env) {
        return env
    }

    const envValid = await probeCliApiToken(apiUrl, env)
    if (envValid) {
        return env
    }

    const settingsValid = await probeCliApiToken(apiUrl, settings)
    if (settingsValid) {
        return settings
    }

    return env
}
