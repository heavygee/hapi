import { describe, expect, it, vi } from 'vitest'
import { attachSessionJob } from './attachSessionJob'
import { SessionJobError } from './sessionJob'

vi.mock('./sessionJob', async () => {
    const actual = await vi.importActual<typeof import('./sessionJob')>('./sessionJob')
    return {
        ...actual,
        resolveSessionJobClient: vi.fn(async () => ({
            sessionId: 'sess-1',
            client: {} as never,
            jwtIssuedAtMs: Date.now()
        })),
        setSessionJob: vi.fn(async () => ({
            sessionId: 'sess-1',
            job: { key: 'xfer', label: 'xfer', status: 'running' }
        })),
        updateSessionJob: vi.fn(async () => ({
            sessionId: 'sess-1',
            job: { key: 'xfer', label: 'xfer', status: 'completed' }
        }))
    }
})

describe('attachSessionJob', () => {
    it('refuses a dead pid before hub set', async () => {
        await expect(attachSessionJob({
            sessionIdPrefix: 'sess',
            jobKey: 'xfer',
            label: 'xfer',
            pid: 999999,
            isAliveImpl: () => false
        })).rejects.toBeInstanceOf(SessionJobError)
    })

    it('registers then completes when pid disappears', async () => {
        const { setSessionJob, updateSessionJob } = await import('./sessionJob')
        let alive = true
        const onRegistered = vi.fn()
        const err = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const done = attachSessionJob({
                sessionIdPrefix: 'sess',
                jobKey: 'xfer',
                label: 'xfer',
                pid: 4242,
                pollMs: 5,
                heartbeatMs: 10_000,
                isAliveImpl: () => alive,
                sleepImpl: async () => {
                    alive = false
                },
                onRegistered
            })
            await expect(done).resolves.toBe(0)
            expect(setSessionJob).toHaveBeenCalled()
            expect(onRegistered).toHaveBeenCalledWith(expect.objectContaining({
                jobKey: 'xfer',
                sessionId: 'sess-1'
            }))
            expect(updateSessionJob).toHaveBeenCalledWith(expect.objectContaining({
                body: expect.objectContaining({ status: 'completed' })
            }))
            expect(err.mock.calls.flat().join(' ')).toMatch(/starting key=xfer/)
            expect(err.mock.calls.flat().join(' ')).toMatch(/registered key=xfer/)
        } finally {
            err.mockRestore()
        }
    })
})
