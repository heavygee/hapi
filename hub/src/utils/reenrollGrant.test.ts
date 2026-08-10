import { describe, expect, it, beforeEach } from 'vitest'
import {
    ackReenrollGrant,
    clearReenrollGrantsForTests,
    consumeReenrollGrant,
    issueReenrollGrant,
    verifyReenrollGrant,
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
            toMachineId: 'machine-new',
        })).toBe(true)
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
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
            toMachineId: 'machine-new',
        })).toBe(false)
        expect(consumeReenrollGrant({
            machineId: 'machine-other',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(false)
    })

    it('keeps the previous grant valid until the replacement is acked', () => {
        const first = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        const second = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: first.grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
        expect(ackReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: first.grant,
        })).toBe(false)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant: second.grant,
        })).toBe(true)
    })

    it('verify does not consume; consume after success deletes', () => {
        const { grant } = issueReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
        })
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(true)
        expect(consumeReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
            toMachineId: 'machine-new',
        })).toBe(true)
        expect(verifyReenrollGrant({
            machineId: 'machine-old',
            namespace: 'default',
            grant,
        })).toBe(false)
    })
})
