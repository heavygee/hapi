import { afterEach, describe, expect, it } from 'vitest'
import {
    applyHubSessionSummaryContract,
    buildSessionSummaryInstruction,
    isSessionSummaryContractEnabled,
    resetSessionSummaryContractForTests,
    SESSION_SUMMARY_CONTRACT_LINE,
    sessionSummaryInstructionOrEmpty,
    withSessionSummaryInstruction
} from './sessionSummaryInstruction'

const PREVIOUS_SESSION_SUMMARY_INSTRUCTION = [
    'Session status summary:',
    'End every response with a single machine-readable status line (no backticks)',
    'so this workspace\'s session tracking can record progress. Put it on its own',
    'final line after all other content:',
    SESSION_SUMMARY_CONTRACT_LINE,
    'Use the language used by the user in the current conversation for the',
    'human-readable "action" and "summary" values.',
    'Use status "blocked" if unsure. When status is "done" and follow-up remains,',
    'keep action to 12 words or fewer. Omit the action key when nothing remains —',
    'never emit "action":"" (Cursor drops a quote and breaks JSON).',
    'Omit agent and project fields.',
].join('\n')

describe('sessionSummaryInstruction', () => {
    afterEach(() => {
        resetSessionSummaryContractForTests()
    })

    it('is disabled by default (upstream opt-in)', () => {
        expect(isSessionSummaryContractEnabled({})).toBe(false)
        expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: '' })).toBe(false)
        expect(sessionSummaryInstructionOrEmpty({})).toBe('')
    })

    it('enables when hub preference is applied', () => {
        applyHubSessionSummaryContract(true)
        expect(isSessionSummaryContractEnabled({})).toBe(true)
        expect(sessionSummaryInstructionOrEmpty({})).toContain(SESSION_SUMMARY_CONTRACT_LINE)

        applyHubSessionSummaryContract(false)
        expect(isSessionSummaryContractEnabled({})).toBe(false)
    })

    it('lets explicit env override hub preference', () => {
        applyHubSessionSummaryContract(true)
        expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: '0' })).toBe(false)
        applyHubSessionSummaryContract(false)
        expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: '1' })).toBe(true)
        expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: 'true' })).toBe(true)
    })

    it('treats common falsy env spellings as off', () => {
        for (const value of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
            expect(isSessionSummaryContractEnabled({ HAPI_SESSION_SUMMARY_CONTRACT: value })).toBe(false)
        }
    })

    it('builds the canonical contract line without surveillance framing', () => {
        const body = buildSessionSummaryInstruction()
        expect(body).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(body.toLowerCase()).toContain('session tracking')
        expect(body.toLowerCase()).not.toContain('overseer')
        expect(body.toLowerCase()).not.toContain('surveillance')
        expect(body).not.toContain('<project>')
        expect(body).not.toContain('<agent-id>')
        expect(SESSION_SUMMARY_CONTRACT_LINE).not.toContain('"agent"')
        expect(SESSION_SUMMARY_CONTRACT_LINE).not.toContain('"project"')
        expect(body.toLowerCase()).toContain('omit the action key')
    })

    it('adds user-language guidance without changing the existing prompt contract', () => {
        applyHubSessionSummaryContract(true)
        const body = sessionSummaryInstructionOrEmpty({})
        expect(body).toBe(PREVIOUS_SESSION_SUMMARY_INSTRUCTION)
    })

    it('preserves the exact machine-readable footer format', () => {
        expect(SESSION_SUMMARY_CONTRACT_LINE).toBe(
            'AGENT_NOTIFY_SUMMARY {"version":1,"status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}'
        )
    })

    it('appends to an existing base prompt when enabled', () => {
        applyHubSessionSummaryContract(true)
        const out = withSessionSummaryInstruction('Be helpful.', {})
        expect(out.startsWith('Be helpful.')).toBe(true)
        expect(out).toContain(SESSION_SUMMARY_CONTRACT_LINE)
    })

    it('leaves base unchanged when disabled', () => {
        expect(withSessionSummaryInstruction('Be helpful.', {})).toBe('Be helpful.')
        expect(withSessionSummaryInstruction('Be helpful.', { HAPI_SESSION_SUMMARY_CONTRACT: '0' }))
            .toBe('Be helpful.')
    })
})
