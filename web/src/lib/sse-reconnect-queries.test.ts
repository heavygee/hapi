import { describe, expect, it } from 'vitest'
import { queryKeys } from '@/lib/query-keys'
import { getSseReconnectQueryKeys } from './sse-reconnect-queries'

describe('getSseReconnectQueryKeys', () => {
    it('refetches the hub upgrade offer after reconnect, not only sessions', () => {
        const keys = getSseReconnectQueryKeys()
        expect(keys).toContainEqual(queryKeys.sessions)
        expect(keys).toContainEqual(['session'])
        expect(keys).toContainEqual(queryKeys.upgradeInfo)
    })
})
