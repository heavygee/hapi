import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuration } from '@/configuration'
import { probeCliApiToken, reconcileCliApiToken } from './cliApiTokenProbe'

describe('probeCliApiToken', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        configuration._setApiUrl('http://127.0.0.1:3006')
        configuration._setExtraHeaders({})
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('returns true when hub returns a JWT', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ token: 'jwt-here' })
        })) as typeof fetch

        await expect(probeCliApiToken('http://127.0.0.1:3006', 'good-token')).resolves.toBe(true)
    })

    it('returns false when hub rejects the token', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            json: async () => ({ error: 'Invalid access token' })
        })) as typeof fetch

        await expect(probeCliApiToken('http://127.0.0.1:3006', 'bad-token')).resolves.toBe(false)
    })
})

describe('reconcileCliApiToken', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        configuration._setApiUrl('http://127.0.0.1:3006')
        configuration._setExtraHeaders({})
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('keeps env token when it authenticates even if settings differs', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { accessToken: string }
            return {
                ok: body.accessToken === 'env-live',
                json: async () => ({ token: body.accessToken === 'env-live' ? 'jwt' : undefined })
            }
        }) as typeof fetch

        await expect(
            reconcileCliApiToken('http://127.0.0.1:3006', 'env-live', 'settings-token')
        ).resolves.toBe('env-live')
    })

    it('falls back to settings when inherited env token is stale', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { accessToken: string }
            return {
                ok: body.accessToken === 'settings-live',
                json: async () => ({ token: body.accessToken === 'settings-live' ? 'jwt' : undefined })
            }
        }) as typeof fetch

        await expect(
            reconcileCliApiToken('http://127.0.0.1:3006', 'stale-env', 'settings-live')
        ).resolves.toBe('settings-live')
    })
})
