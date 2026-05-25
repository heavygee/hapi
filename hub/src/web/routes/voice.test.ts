import { describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import type { WebAppEnv } from '../middleware/auth'
import { createAuthMiddleware } from '../middleware/auth'
import { createVoiceRoutes } from './voice'

const JWT_SECRET = new TextEncoder().encode('test-secret')

async function authHeaders() {
    const token = await new SignJWT({ uid: 1, ns: 'default' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET)
    return { authorization: `Bearer ${token}` }
}

function createApp() {
    const app = new Hono<WebAppEnv>()
    app.use('*', createAuthMiddleware(JWT_SECRET))
    app.route('/api', createVoiceRoutes())
    return app
}

describe('GET /api/voice/voices', () => {
    it('returns 401 without auth', async () => {
        const app = createApp()
        const res = await app.request('/api/voice/voices')
        expect(res.status).toBe(401)
    })

    it('returns empty list when ELEVENLABS_API_KEY is not set', async () => {
        const app = createApp()
        const headers = await authHeaders()
        const prev = process.env.ELEVENLABS_API_KEY
        delete process.env.ELEVENLABS_API_KEY

        const res = await app.request('/api/voice/voices', { headers })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ voices: [] })

        if (prev) process.env.ELEVENLABS_API_KEY = prev
    })

    it('maps ElevenLabs voice fields correctly', async () => {
        const app = createApp()
        const headers = await authHeaders()
        const prev = process.env.ELEVENLABS_API_KEY
        process.env.ELEVENLABS_API_KEY = 'test-key'

        const fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify({
            voices: [
                { voice_id: 'v1', name: 'Alice', preview_url: 'https://cdn.example/a.mp3', category: 'premade' },
                { voice_id: 'v2', name: 'MyClone', preview_url: 'https://cdn.example/c.mp3', category: 'cloned' },
            ]
        }), { status: 200 })))

        const originalFetch = global.fetch
        // @ts-expect-error test override
        global.fetch = fetchMock

        const res = await app.request('/api/voice/voices', { headers })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            voices: [
                { id: 'v1', name: 'Alice', previewUrl: 'https://cdn.example/a.mp3', category: 'premade' },
                { id: 'v2', name: 'MyClone', previewUrl: 'https://cdn.example/c.mp3', category: 'cloned' },
            ]
        })

        global.fetch = originalFetch
        if (prev) process.env.ELEVENLABS_API_KEY = prev
        else delete process.env.ELEVENLABS_API_KEY
    })
})
