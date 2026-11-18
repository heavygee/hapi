import { buildAgentTitleSteer, isNameOnceAgentTitlePolicy } from '@/modules/common/agentTitlePolicy'
import { SKILL_LOOKUP_INSTRUCTION } from '@/modules/common/skillLookupInstruction'
import { withSessionJobInstruction } from '@/modules/common/sessionJobInstruction'
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction'

export const GROK_TITLE_INSTRUCTION =
    `Use the tool "hapi_change_title" once after the initial request is clear to set a concise session title. Do not rename for routine progress or substeps.\n${SKILL_LOOKUP_INSTRUCTION}`

export function getGrokTitleInstruction(env: NodeJS.ProcessEnv = process.env): string {
    const title = isNameOnceAgentTitlePolicy(env)
        ? `${buildAgentTitleSteer('hapi_change_title', env)}\n${SKILL_LOOKUP_INSTRUCTION}`
        : GROK_TITLE_INSTRUCTION
    return withSessionSummaryInstruction(withSessionJobInstruction(title), env)
}
