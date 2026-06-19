import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/api'
import {
    notifyGardenSessionFocus,
    prefetchGardenVoiceContext,
    primeVoiceHooksForGarden,
} from '@/garden/utils/gardenVoiceContext'
import { voiceHooks } from '@/realtime/hooks/voiceHooks'

function makeSession(id: string): Session {
    return {
        id,
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: { path: '/proj', host: 'local' },
        thinking: false,
    } as Session
}

describe('prefetchGardenVoiceContext', () => {
    it('returns session and messages from api + message window', async () => {
        const session = makeSession('sess-1')
        const api = {
            getSession: vi.fn(async () => ({ session })),
            getMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
        } as unknown as import('@/api/client').ApiClient

        const result = await prefetchGardenVoiceContext(api, 'sess-1')
        expect(result?.session.id).toBe('sess-1')
        expect(Array.isArray(result?.messages)).toBe(true)
    })
})

describe('primeVoiceHooksForGarden', () => {
    it('registers prefetched session for prepareVoiceSession', () => {
        const session = makeSession('sess-1')
        primeVoiceHooksForGarden({ session, messages: [] })
        const plan = voiceHooks.prepareVoiceSession('sess-1')
        expect(plan.bootstrap).toContain('sess-1')
    })
})

describe('notifyGardenSessionFocus', () => {
    it('calls voiceHooks.onSessionFocus', () => {
        const spy = vi.spyOn(voiceHooks, 'onSessionFocus').mockImplementation(() => {})
        notifyGardenSessionFocus('sess-1', { path: '/x', host: 'local' })
        expect(spy).toHaveBeenCalledWith('sess-1', { path: '/x', host: 'local' })
        spy.mockRestore()
    })
})
