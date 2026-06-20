const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'

/** Hub origins that share one CLI token in operator setup. */
export const GARDEN_SIBLING_HUB_ORIGINS = [
    'https://hapi.tail9944ee.ts.net',
    'https://garden.tail9944ee.ts.net',
    'http://127.0.0.1:5174',
    'http://localhost:5174',
    'http://127.0.0.1:3006',
    'http://localhost:3006',
] as const

function accessTokenKey(baseUrl: string): string {
    return `${ACCESS_TOKEN_PREFIX}${baseUrl}`
}

/**
 * Garden runs on a different origin than HAPI but proxies to the same hub.
 * Copy an existing access token from a sibling origin so login on hapi.* works on garden.*.
 */
export function syncGardenAccessTokenFromSiblingHubs(baseUrl: string): boolean {
    try {
        const ownKey = accessTokenKey(baseUrl)
        if (localStorage.getItem(ownKey)) {
            return true
        }

        for (const origin of GARDEN_SIBLING_HUB_ORIGINS) {
            if (origin === baseUrl) {
                continue
            }
            const siblingToken = localStorage.getItem(accessTokenKey(origin))
            if (siblingToken) {
                localStorage.setItem(ownKey, siblingToken)
                return true
            }
        }
    } catch {
        return false
    }

    return false
}

export function isGardenPath(pathname: string): boolean {
    return pathname === '/garden' || pathname.startsWith('/garden/')
}
