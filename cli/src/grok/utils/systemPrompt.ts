import { SKILL_LOOKUP_INSTRUCTION } from '@/modules/common/skillLookupInstruction'

/**
 * One-shot first-turn instruction for Grok (no durable system-prompt channel).
 * Prepended to the first user message in grokRemoteLauncher — must NOT carry
 * AGENT_NOTIFY_SUMMARY (user-turn prepend is the #1095/#1096 injection false
 * positive). Session-summary for Grok is #89.
 */
export const GROK_TITLE_INSTRUCTION =
    `Use the tool "hapi_change_title" once after the initial request is clear to set a concise session title. Do not rename for routine progress or substeps.\n${SKILL_LOOKUP_INSTRUCTION}`
