import { describe, expect, it, vi } from 'vitest'
import { executeSessionRelay } from './sessionRelay'

describe('executeSessionRelay', () => {
    it('sends to the requested id when the session is already active', async () => {
        const sendMessage = vi.fn().mockResolvedValue(undefined)
        const result = await executeSessionRelay(
            {
                getSession: () => ({ active: true }),
                resumeSession: vi.fn(),
                sendMessage
            },
            { sessionId: 'old-id', message: 'hello', namespace: 'default' }
        )
        expect(result).toEqual({ ok: true, resumed: false, sessionId: 'old-id' })
        expect(sendMessage).toHaveBeenCalledWith('old-id', { text: 'hello', sentFrom: 'webapp' })
    })

    it('sends to the resumed session id when resume remaps', async () => {
        const sendMessage = vi.fn().mockResolvedValue(undefined)
        const resumeSession = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'new-id' })
        const result = await executeSessionRelay(
            {
                getSession: () => ({ active: false }),
                resumeSession,
                sendMessage
            },
            { sessionId: 'old-id', message: 'wake up', namespace: 'ns-a' }
        )
        expect(resumeSession).toHaveBeenCalledWith('old-id', 'ns-a')
        expect(result).toEqual({ ok: true, resumed: true, sessionId: 'new-id' })
        expect(sendMessage).toHaveBeenCalledWith('new-id', { text: 'wake up', sentFrom: 'webapp' })
        expect(sendMessage).not.toHaveBeenCalledWith('old-id', expect.anything())
    })

    it('returns resume failure without sending', async () => {
        const sendMessage = vi.fn()
        const result = await executeSessionRelay(
            {
                getSession: () => ({ active: false }),
                resumeSession: async () => ({ type: 'error', code: 'no_machine_online', message: 'No machine online' }),
                sendMessage
            },
            { sessionId: 'old-id', message: 'x' }
        )
        expect(result).toEqual({
            ok: false,
            resumed: false,
            sessionId: 'old-id',
            error: 'no_machine_online'
        })
        expect(sendMessage).not.toHaveBeenCalled()
    })

    it('returns session_not_found when missing', async () => {
        const result = await executeSessionRelay(
            {
                getSession: () => undefined,
                resumeSession: vi.fn(),
                sendMessage: vi.fn()
            },
            { sessionId: 'ghost', message: 'x' }
        )
        expect(result).toMatchObject({ ok: false, error: 'session_not_found', sessionId: 'ghost' })
    })
})
