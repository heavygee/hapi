import { describe, expect, it } from 'bun:test'
import { shouldInjectNotifyContract } from './overseerEventRecorder'
import { AGENT_NOTIFY_CONTRACT_INLINE_PREFIX } from '@hapi/protocol'

describe('notify contract injection', () => {
    it('skips cursor flavor', () => {
        expect(shouldInjectNotifyContract('cursor')).toBe(false)
    })

    it('injects for claude and codex', () => {
        expect(shouldInjectNotifyContract('claude')).toBe(true)
        expect(shouldInjectNotifyContract('codex')).toBe(true)
    })

    it('prefix contains AGENT_NOTIFY_SUMMARY instruction', () => {
        expect(AGENT_NOTIFY_CONTRACT_INLINE_PREFIX).toContain('AGENT_NOTIFY_SUMMARY')
    })
})
