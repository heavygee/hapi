import { describe, expect, it } from 'vitest'
import { parseSearchPeersArgs } from './searchPeers'
import { PingPeerError } from '@/modules/pingPeer/pingPeer'

describe('parseSearchPeersArgs', () => {
    it('parses query and limit', () => {
        expect(parseSearchPeersArgs(['hetzner', '--limit', '20'])).toEqual({
            help: false,
            query: 'hetzner',
            limit: 20
        })
    })

    it('joins multi-word query args', () => {
        expect(parseSearchPeersArgs(['Arthur', 'Scout', 'deploy'])).toEqual({
            help: false,
            query: 'Arthur Scout deploy'
        })
    })

    it('rejects bad limit', () => {
        expect(() => parseSearchPeersArgs(['q', '--limit', '0'])).toThrow(PingPeerError)
    })
})
