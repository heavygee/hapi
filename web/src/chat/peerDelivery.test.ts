import { describe, expect, it } from 'vitest'
import {
    getPeerDeliveryInfo,
    isPeerDeliveryMeta,
    parseClaimedPeerFromText,
    stripClaimedPeerHeaderForDisplay,
} from './peerDelivery'

describe('peerDelivery', () => {
    it('detects peer sentFrom and extracts optional source fields', () => {
        expect(isPeerDeliveryMeta({ sentFrom: 'webapp' })).toBe(false)
        expect(isPeerDeliveryMeta({ sentFrom: 'peer' })).toBe(true)
        expect(getPeerDeliveryInfo({
            sentFrom: 'peer',
            peer: {
                sourceSessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
                sourceName: 'Orchestrator'
            }
        })).toEqual({
            sourceSessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            sourceName: 'Orchestrator'
        })
        expect(getPeerDeliveryInfo({ sentFrom: 'peer', peer: {} })).toEqual({
            sourceSessionId: undefined,
            sourceName: undefined
        })
    })

    it('parses claimed From: /sessions stamps for unverified UI', () => {
        expect(parseClaimedPeerFromText(
            'From: /sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4 (Orchestrator)\n\nhello'
        )).toEqual({
            sessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            name: 'Orchestrator',
        })
        expect(parseClaimedPeerFromText(
            'From: /sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4\nName: Meta tooling\n\nbody'
        )).toEqual({
            sessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
            name: 'Meta tooling',
        })
        expect(parseClaimedPeerFromText('From: peer (unattributed)\n\nbody')).toEqual({})
        expect(parseClaimedPeerFromText('just a normal message')).toBeNull()
    })

    it('strips claimed From: headers from bubble display text', () => {
        expect(stripClaimedPeerHeaderForDisplay(
            'From: /sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4 (Orchestrator)\n\nhello'
        )).toBe('hello')
        expect(stripClaimedPeerHeaderForDisplay(
            'From: /sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4\nName: Meta\n\nbody'
        )).toBe('body')
        expect(stripClaimedPeerHeaderForDisplay('no stamp')).toBe('no stamp')
    })
})
