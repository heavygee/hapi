import { describe, expect, it } from 'bun:test'
import {
    extractInboundUserTextPreview,
    hasClaimedPeerHeaderInText,
    isUnverifiedPeerInbound,
} from './provenanceMessageAudit'

const SOURCE_ID = '6212dae5-8a60-4284-b7a5-c09aa3571ce4'

function userEnvelope(overrides?: {
    sentFrom?: string
    peer?: Record<string, unknown>
    text?: string
    role?: string
}): Record<string, unknown> {
    const meta: Record<string, unknown> = {}
    if (overrides?.sentFrom) {
        meta.sentFrom = overrides.sentFrom
    }
    if (overrides?.peer) {
        meta.peer = overrides.peer
    }
    return {
        role: overrides?.role ?? 'user',
        content: { type: 'text', text: overrides?.text ?? 'hello' },
        meta,
    }
}

describe('isUnverifiedPeerInbound', () => {
    it('matches peer delivery without sourceSessionId', () => {
        expect(isUnverifiedPeerInbound(userEnvelope({ sentFrom: 'peer' }))).toBe(true)
        expect(isUnverifiedPeerInbound(userEnvelope({
            sentFrom: 'peer',
            peer: {},
        }))).toBe(true)
    })

    it('rejects attributed peer delivery', () => {
        expect(isUnverifiedPeerInbound(userEnvelope({
            sentFrom: 'peer',
            peer: { sourceSessionId: SOURCE_ID, sourceName: 'Orchestrator' },
        }))).toBe(false)
    })

    it('rejects webapp and non-user roles', () => {
        expect(isUnverifiedPeerInbound(userEnvelope({ sentFrom: 'webapp' }))).toBe(false)
        expect(isUnverifiedPeerInbound(userEnvelope({ sentFrom: 'peer', role: 'agent' }))).toBe(false)
    })
})

describe('extractInboundUserTextPreview', () => {
    it('reads nested text blocks and truncates', () => {
        const long = 'x'.repeat(200)
        const preview = extractInboundUserTextPreview(userEnvelope({ text: long }), 50)
        expect(preview.endsWith('…')).toBe(true)
        expect(preview.length).toBeLessThanOrEqual(50)
    })
})

describe('hasClaimedPeerHeaderInText', () => {
    it('detects From: /sessions/<uuid> prose stamp', () => {
        const content = userEnvelope({
            sentFrom: 'peer',
            text: `From: /sessions/${SOURCE_ID} (Orchestrator)\n\nbody`,
        })
        expect(hasClaimedPeerHeaderInText(content)).toBe(true)
    })

    it('detects unattributed From: peer stamp', () => {
        const content = userEnvelope({
            sentFrom: 'peer',
            text: 'From: peer (unattributed)\n\nbody',
        })
        expect(hasClaimedPeerHeaderInText(content)).toBe(true)
    })
})
