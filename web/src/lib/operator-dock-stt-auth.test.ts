import { describe, expect, it, vi } from 'vitest'
import { isHubSttUrl, wrapOperatorDockSttRequest } from './operator-dock-stt-auth'

describe('operator dock STT uses HAPI JWT not the gate secret', () => {
    it('matches hub /api/stt and not the /hapi proxy', () => {
        expect(isHubSttUrl('/api/stt')).toBe(true)
        expect(isHubSttUrl('https://hapi.example/api/stt')).toBe(true)
        expect(isHubSttUrl('/hapi/api/stt')).toBe(false)
        expect(isHubSttUrl('/hapi/operator/sessions')).toBe(false)
    })

    it('attaches Authorization and strips gate-secret headers', async () => {
        const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            return new Response(JSON.stringify({ ok: true, text: 'hi' }), { status: 200 })
        })
        await wrapOperatorDockSttRequest(
            '/api/stt',
            {
                method: 'POST',
                headers: {
                    'X-Hapi-Inline-Secret': 'gate',
                    'X-Operator-Mic-Secret': 'gate',
                    'Content-Type': 'application/json'
                },
                body: '{"audio_b64":"YQ=="}'
            },
            () => 'hub-jwt',
            fetchImpl as unknown as typeof fetch
        )
        expect(fetchImpl).toHaveBeenCalledOnce()
        const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
        expect(headers.get('Authorization')).toBe('Bearer hub-jwt')
        expect(headers.get('X-Hapi-Inline-Secret')).toBeNull()
        expect(headers.get('X-Operator-Mic-Secret')).toBeNull()
    })

    it('does not treat a missing JWT as a gate-secret 401', async () => {
        const fetchImpl = vi.fn()
        const res = await wrapOperatorDockSttRequest(
            '/api/stt',
            { method: 'POST', headers: { 'X-Hapi-Inline-Secret': 'gate' } },
            () => null,
            fetchImpl as unknown as typeof fetch
        )
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(res.status).toBe(200)
        const body = await res.json() as { ok: boolean, error: string }
        expect(body.ok).toBe(false)
        expect(body.error.toLowerCase()).toContain('sign in')
        expect(body.error.toLowerCase()).not.toContain('secret incorrect')
    })

    it('leaves /hapi proxy fetches alone', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
        await wrapOperatorDockSttRequest(
            '/hapi/operator/sessions',
            { headers: { 'X-Hapi-Inline-Secret': 'gate' } },
            () => 'hub-jwt',
            fetchImpl as unknown as typeof fetch
        )
        expect(fetchImpl.mock.calls[0]?.[0]).toBe('/hapi/operator/sessions')
        const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
        expect(headers.get('Authorization')).toBeNull()
        expect(headers.get('X-Hapi-Inline-Secret')).toBe('gate')
    })
})
