import { describe, expect, it } from 'vitest'
import type { KitchenStatusResponse } from '@hapi/protocol/apiTypes'
import { isKitchenStatusDirty, kitchenStatusSeverity } from './KitchenStatusChip'

function makeStatus(overrides: Partial<Extract<KitchenStatusResponse, { available: true }>>): KitchenStatusResponse {
    return {
        available: true,
        status: 'green',
        driverHead: 'abc1234',
        driverLayers: 3,
        mirror: 'clean',
        mirrorDirty: false,
        forkAhead: 0,
        forkBehind: 0,
        working: '0',
        holdActive: false,
        holdReason: '',
        lease: 'unheld',
        driverBusy: false,
        ruleChopped: false,
        oneliner: 'kitchen: green',
        checkedAt: 0,
        ...overrides
    }
}

describe('isKitchenStatusDirty', () => {
    it('is false for null, unavailable, or plain green status', () => {
        expect(isKitchenStatusDirty(null)).toBe(false)
        expect(isKitchenStatusDirty({ available: false })).toBe(false)
        expect(isKitchenStatusDirty(makeStatus({ status: 'green' }))).toBe(false)
    })

    it('is true for dirty, hold, busy, and rule-chop suffixed statuses', () => {
        expect(isKitchenStatusDirty(makeStatus({ status: 'dirty', mirrorDirty: true }))).toBe(true)
        expect(isKitchenStatusDirty(makeStatus({ status: 'hold', holdActive: true }))).toBe(true)
        expect(isKitchenStatusDirty(makeStatus({ status: 'busy', driverBusy: true }))).toBe(true)
        expect(isKitchenStatusDirty(makeStatus({ status: 'green+rule-chop', ruleChopped: true }))).toBe(true)
    })
})

describe('kitchenStatusSeverity', () => {
    it('is null when clean or unavailable', () => {
        expect(kitchenStatusSeverity(null)).toBeNull()
        expect(kitchenStatusSeverity({ available: false })).toBeNull()
        expect(kitchenStatusSeverity(makeStatus({ status: 'green' }))).toBeNull()
    })

    it('is error when a remat hold is active, regardless of other dirt', () => {
        expect(kitchenStatusSeverity(makeStatus({ status: 'hold', holdActive: true }))).toBe('error')
        expect(kitchenStatusSeverity(makeStatus({
            status: 'hold',
            holdActive: true,
            mirrorDirty: true
        }))).toBe('error')
    })

    it('is warning for dirty/busy/rule-chop without an active hold', () => {
        expect(kitchenStatusSeverity(makeStatus({ status: 'dirty', mirrorDirty: true }))).toBe('warning')
        expect(kitchenStatusSeverity(makeStatus({ status: 'busy', driverBusy: true }))).toBe('warning')
        expect(kitchenStatusSeverity(makeStatus({ status: 'green+rule-chop', ruleChopped: true }))).toBe('warning')
    })
})
