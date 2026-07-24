import { describe, expect, it, beforeEach } from 'vitest'
import { syncGardenAccessTokenFromSiblingHubs } from '@/garden/gardenAuthBootstrap'

describe('syncGardenAccessTokenFromSiblingHubs', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('copies token from hapi origin to garden origin', () => {
        localStorage.setItem('hapi_access_token::https://hapi.tail9944ee.ts.net', 'secret-token')

        const synced = syncGardenAccessTokenFromSiblingHubs('https://garden.tail9944ee.ts.net')

        expect(synced).toBe(true)
        expect(localStorage.getItem('hapi_access_token::https://garden.tail9944ee.ts.net')).toBe('secret-token')
    })

    it('returns true when garden already has a token', () => {
        localStorage.setItem('hapi_access_token::https://garden.tail9944ee.ts.net', 'existing')

        expect(syncGardenAccessTokenFromSiblingHubs('https://garden.tail9944ee.ts.net')).toBe(true)
    })
})
