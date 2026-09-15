import { describe, expect, it } from 'vitest'
import { remoteSystemPrompt, systemPrompt } from '@/claude/utils/systemPrompt'
import { TITLE_INSTRUCTION as codexTitle, codexSystemPrompt } from '@/codex/utils/systemPrompt'
import { GROK_TITLE_INSTRUCTION } from '@/grok/utils/systemPrompt'
import { TITLE_INSTRUCTION as opencodeTitle } from '@/opencode/utils/systemPrompt'
import { SESSION_SUMMARY_CONTRACT_LINE } from './sessionSummaryInstruction'

describe('flavor notify contract placement', () => {
    it('puts AGENT_NOTIFY_SUMMARY on Claude/Codex remote instructions only', () => {
        expect(remoteSystemPrompt).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(codexSystemPrompt).toContain(SESSION_SUMMARY_CONTRACT_LINE)
        expect(systemPrompt).not.toContain('AGENT_NOTIFY_SUMMARY')
        expect(codexTitle).not.toContain('AGENT_NOTIFY_SUMMARY')
    })

    it('keeps Grok/OpenCode first-turn prepend free of the machine contract', () => {
        expect(GROK_TITLE_INSTRUCTION).not.toContain('AGENT_NOTIFY_SUMMARY')
        expect(opencodeTitle).not.toContain('AGENT_NOTIFY_SUMMARY')
    })
})
