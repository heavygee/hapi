import { describe, expect, it } from 'vitest'
import { classifyMachineRegistrationProbe } from './doctorMachineRegistration'

describe('classifyMachineRegistrationProbe', () => {
    it('treats 200 as ok', () => {
        expect(classifyMachineRegistrationProbe({
            httpStatus: 200,
            responseErrorText: '',
        })).toEqual({ ok: true, status: 200, detail: 'registered' })
    })

    it('treats 409 proof mismatch as tag-verified ok', () => {
        expect(classifyMachineRegistrationProbe({
            httpStatus: 409,
            responseErrorText: 'Machine runner proof mismatch; re-enroll with a new machine id',
        })).toEqual({
            ok: true,
            status: 409,
            detail: 'Machine runner proof mismatch; re-enroll with a new machine id',
            tagVerifiedProofRequired: true,
        })
    })

    it('treats 409 tag mismatch as failure', () => {
        expect(classifyMachineRegistrationProbe({
            httpStatus: 409,
            responseErrorText: 'Machine tag mismatch',
        })).toEqual({
            ok: false,
            status: 409,
            detail: 'Machine tag mismatch',
        })
    })

    it('treats 500 as failure', () => {
        expect(classifyMachineRegistrationProbe({
            httpStatus: 500,
            responseErrorText: 'Machine tag mismatch',
        })).toEqual({
            ok: false,
            status: 500,
            detail: 'Machine tag mismatch',
        })
    })
})
