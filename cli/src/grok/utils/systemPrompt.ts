import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction'

/**
 * One-shot first-turn instruction for Grok (no durable system-prompt channel).
 * Includes the session-status summary contract when enabled.
 */
export const GROK_TITLE_INSTRUCTION = withSessionSummaryInstruction(
    'Use the tool "hapi_change_title" once after the initial request is clear to set a concise session title. Do not rename for routine progress or substeps.'
)
