import { describe, expect, it, vi } from 'vitest'
import { Session } from './session'

function makeSession(opts: {
    sessionId: string | null
    claudeArgs?: string[]
}) {
    const metadata: Record<string, unknown> = {
        claudeSessionId: opts.sessionId ?? undefined
    }
    const updateMetadata = vi.fn((handler: (meta: Record<string, unknown>) => Record<string, unknown>) => {
        Object.assign(metadata, handler(metadata))
        return metadata
    })
    const sendSessionEvent = vi.fn()
    const session = new Session({
        api: {} as never,
        client: {
            updateMetadata,
            keepAlive() {},
            emitMessagesConsumed() {},
            sendSessionEvent,
            getMetadata: () => metadata
        } as never,
        path: '/tmp',
        logPath: '/tmp/test.log',
        sessionId: opts.sessionId,
        claudeArgs: opts.claudeArgs,
        mcpServers: {},
        messageQueue: { onBatchConsumed: null } as never,
        onModeChange: () => {},
        startedBy: 'runner',
        startingMode: 'remote',
        hookSettingsPath: '/tmp/hooks.json'
    })
    return { session, metadata, updateMetadata, sendSessionEvent }
}

describe('Session.onSessionFound resume mismatch (#1933)', () => {
    it('does not overwrite claudeSessionId when resume requested A and Claude reports B', () => {
        const requested = 'c66b46bc-7647-491a-9cd4-06ba640b9910'
        const minted = '3e0eb081-1111-4111-8111-111111111111'
        const { session, metadata, updateMetadata, sendSessionEvent } = makeSession({
            sessionId: requested
        })

        session.onSessionFound(minted)

        expect(session.sessionId).toBe(requested)
        expect(metadata.claudeSessionId).toBe(requested)
        expect(updateMetadata).not.toHaveBeenCalled()
        expect(sendSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'message',
            message: expect.stringContaining('resume mismatch')
        }))
    })

    it('still adopts a forked child id when --fork-session was requested', () => {
        const parent = 'parent-session-id'
        const child = 'child-session-id'
        const { session, metadata, updateMetadata } = makeSession({
            sessionId: parent,
            claudeArgs: ['--resume', parent, '--fork-session']
        })

        session.onSessionFound(child, { forkedFrom: parent })

        expect(session.sessionId).toBe(child)
        expect(metadata.claudeSessionId).toBe(child)
        expect(updateMetadata).toHaveBeenCalled()
    })

    it('adopts a matching resume id', () => {
        const id = 'same-session-id'
        const { session, metadata, updateMetadata } = makeSession({ sessionId: id })

        session.onSessionFound(id)

        expect(session.sessionId).toBe(id)
        expect(metadata.claudeSessionId).toBe(id)
        expect(updateMetadata).toHaveBeenCalled()
    })
})
