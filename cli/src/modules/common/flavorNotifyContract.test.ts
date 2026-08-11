import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSystemPrompt } from '@/claude/utils/systemPrompt'
import { TITLE_INSTRUCTION as codexTitle, getCodexSystemPrompt } from '@/codex/utils/systemPrompt'
import { GROK_TITLE_INSTRUCTION, getGrokTitleInstruction } from '@/grok/utils/systemPrompt'
import { TITLE_INSTRUCTION as opencodeTitle, getTitleInstruction } from '@/opencode/utils/systemPrompt'
import {
    SESSION_SUMMARY_CONTRACT_LINE,
    applyHubSessionSummaryContract,
    resetSessionSummaryContractForTests,
} from './sessionSummaryInstruction'

describe('flavor notify contract placement', () => {
    beforeEach(() => {
        resetSessionSummaryContractForTests()
    })

    afterEach(() => {
        resetSessionSummaryContractForTests()
    })

    it('puts AGENT_NOTIFY_SUMMARY on Claude/Codex remote instructions when enabled', () => {
        applyHubSessionSummaryContract(true)
        expect(getSystemPrompt()).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(getCodexSystemPrompt({ HAPI_SESSION_SUMMARY_CONTRACT: '1' })).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        applyHubSessionSummaryContract(false)
        expect(getSystemPrompt()).not.toContain('AGENT_NOTIFY_SUMMARY')
        expect(codexTitle).not.toContain('AGENT_NOTIFY_SUMMARY')
    })

    it('keeps Grok/OpenCode first-turn prepend constants free of the machine contract', () => {
        expect(GROK_TITLE_INSTRUCTION).not.toContain('AGENT_NOTIFY_SUMMARY')
        expect(opencodeTitle).not.toContain('AGENT_NOTIFY_SUMMARY')
        expect(getGrokTitleInstruction({ HAPI_SESSION_SUMMARY_CONTRACT: '1' })).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(getTitleInstruction({ HAPI_SESSION_SUMMARY_CONTRACT: '1' })).toContain(SESSION_SUMMARY_CONTRACT_LINE)
    })
})
