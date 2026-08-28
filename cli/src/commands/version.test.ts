import { describe, expect, it } from 'bun:test'
import { fetchHubTargetGeneration } from './version'

describe('fetchHubTargetGeneration', () => {
    it('returns hub targetGeneration after JWT exchange', async () => {
        const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            if (url.endsWith('/api/auth')) {
                expect(init?.method).toBe('POST')
                return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
            }
            if (url.endsWith('/api/upgrade/offer')) {
                expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
                return new Response(JSON.stringify({
                    offer: { targetGeneration: 'abc123' },
                }), { status: 200 })
            }
            return new Response('no', { status: 404 })
        }) as unknown as typeof fetch
        const gen = await fetchHubTargetGeneration({
            apiUrl: 'http://hub.example',
            accessToken: 'cli-token',
            fetchImpl,
        })
        expect(gen).toBe('abc123')
    })

    it('returns null when auth is missing', async () => {
        const gen = await fetchHubTargetGeneration({
            apiUrl: 'http://hub.example',
            accessToken: '',
            fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
        })
        expect(gen).toBeNull()
    })
})
