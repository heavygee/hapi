import { afterEach, describe, expect, it, vi } from 'vitest'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'

const requestParentPeerDeliver = vi.hoisted(() => vi.fn())
const pingPeer = vi.hoisted(() => vi.fn())

vi.mock('@/api/peerDeliverBroker', () => ({
    requestParentPeerDeliver,
}))

vi.mock('@/modules/pingPeer/pingPeer', async () => {
    const actual = await vi.importActual<typeof import('@/modules/pingPeer/pingPeer')>('@/modules/pingPeer/pingPeer')
    return {
        ...actual,
        pingPeer,
        listPeerSessions: vi.fn(),
    }
})

vi.mock('@/ui/tokenInit', () => ({
    initializeToken: vi.fn(async () => {}),
}))

import { handlePingPeerCommand } from './pingPeer'
import { PingPeerError } from '@/modules/pingPeer/pingPeer'

describe('hapi ping-peer provenance (#1203 M4)', () => {
    afterEach(() => {
        delete process.env[HAPI_SESSION_ID_ENV]
        requestParentPeerDeliver.mockReset()
        pingPeer.mockReset()
    })

    it('routes wrapped invocations through the parent broker (no silent unattributed)', async () => {
        process.env[HAPI_SESSION_ID_ENV] = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        requestParentPeerDeliver.mockResolvedValue({
            sessionId: '05d9f0f2-9273-4137-933c-07459a1146a2',
            name: 'Target',
            resumed: false,
        })

        await handlePingPeerCommand(['05d9f0f2', 'hello from wrapped'])

        expect(requestParentPeerDeliver).toHaveBeenCalledWith(expect.objectContaining({
            sessionIdPrefix: '05d9f0f2',
            message: 'hello from wrapped',
        }))
        expect(pingPeer).not.toHaveBeenCalled()
    })

    it('fails closed when wrapped but broker rejects missing proof', async () => {
        process.env[HAPI_SESSION_ID_ENV] = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'
        requestParentPeerDeliver.mockRejectedValue(
            new PingPeerError('auth_failed', 'broker unavailable')
        )

        await expect(handlePingPeerCommand(['05d9f0f2', 'hello']))
            .rejects.toMatchObject({ code: 'auth_failed' })
        expect(pingPeer).not.toHaveBeenCalled()
    })

    it('keeps outside-session invocations on the unattributed path', async () => {
        pingPeer.mockResolvedValue({
            sessionId: '05d9f0f2-9273-4137-933c-07459a1146a2',
            name: 'Target',
            resumed: false,
        })

        await handlePingPeerCommand(['05d9f0f2', 'hello from outside'])

        expect(requestParentPeerDeliver).not.toHaveBeenCalled()
        expect(pingPeer).toHaveBeenCalledWith(expect.objectContaining({
            sessionIdPrefix: '05d9f0f2',
            message: 'hello from outside',
        }))
        expect(pingPeer.mock.calls[0]![0]).not.toHaveProperty('authenticatedSourceSessionId')
    })
})
