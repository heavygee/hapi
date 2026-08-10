import { describe, expect, it, beforeEach } from 'vitest'
import {
    clearReenrollGrantsForTests,
    consumeReenrollGrant,
    issueReenrollGrant,
} from './reenrollGrant'

describe('reenrollGrant (#1473)', () => {
    beforeEach(() => {
        clearReenrollGrantsForTests()
    })

    it('issues a one-time grant that migrates only once', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(true)
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(false)
    })

    it('rejects wrong namespace or machine id', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'other',
            grant,
        })).toBe(false)
        expect(consumeReenrollGrant({
            machineId: 'machine-other',
            namespace: 'default',
            grant,
        })).toBe(false)
    })
})
