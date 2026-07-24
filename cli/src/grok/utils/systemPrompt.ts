import { SKILL_LOOKUP_INSTRUCTION } from '@/modules/common/skillLookupInstruction'
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction'

/**
 * One-shot first-turn instruction for Grok (no durable system-prompt channel).
 * Keeps upstream skill-lookup; session-status summary contract when enabled.
 */
export const GROK_TITLE_INSTRUCTION = withSessionSummaryInstruction(
    `Use the tool "hapi_change_title" once after the initial request is clear to set a concise session title. Do not rename for routine progress or substeps.\n${SKILL_LOOKUP_INSTRUCTION}`
)
