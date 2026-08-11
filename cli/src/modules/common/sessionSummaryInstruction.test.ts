import { describe, expect, it } from 'vitest'
import {
    buildSessionSummaryInstruction,
    isSessionSummaryContractEnabled,
    SESSION_SUMMARY_CONTRACT_LINE,
    sessionSummaryInstructionOrEmpty,
    withSessionSummaryInstruction
} from './sessionSummaryInstruction'

describe('sessionSummaryInstruction', () => {
    it('is enabled by default', () => {
        expect(isSessionSummaryContractEnabled({})).toBe(true)
        expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: '' })).toBe(true)
    })

    it('respects opt-out env values', () => {
        for (const value of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
            expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: value })).toBe(false)
        }
        expect(sessionSummaryInstructionOrEmpty({ HAPI_SESSION_SUMMARY_CONTRACT: '0' })).toBe('')
    })

    it('builds the canonical contract line', () => {
        const body = buildSessionSummaryInstruction()
        expect(body).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(body.toLowerCase()).toContain('session tracking')
        expect(body.toLowerCase()).not.toContain('overseer')
        expect(body.toLowerCase()).not.toContain('surveillance')
        expect(body).not.toContain('<project>')
        expect(body).not.toContain('<agent-id>')
        expect(SESSION_SUMMARY_CONTRACT_LINE).not.toContain('"agent"')
        expect(SESSION_SUMMARY_CONTRACT_LINE).not.toContain('"project"')
    })

    it('appends to an existing base prompt', () => {
        const out = withSessionSummaryInstruction('Be helpful.', {})
        expect(out.startsWith('Be helpful.')).toBe(true)
        expect(out).toContain(SESSION_SUMMARY_CONTRACT_LINE)
    })

    it('leaves base unchanged when disabled', () => {
        expect(withSessionSummaryInstruction('Be helpful.', { HAPI_SESSION_SUMMARY_CONTRACT: '0' }))
            .toBe('Be helpful.')
    })
})
