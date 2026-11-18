import type { AgentTitlePolicy } from '@hapi/protocol'

/**
 * Hub agent-title policy from session bootstrap (tiann/hapi#271).
 * Env `HAPI_AGENT_TITLE_POLICY=name_once|allow_rename` overrides hub.
 */

let hubPreference: AgentTitlePolicy | undefined

export function applyHubAgentTitlePolicy(policy: AgentTitlePolicy): void {
    hubPreference = policy === 'name_once' ? 'name_once' : 'allow_rename'
}

/** Test-only: clear hub preference between cases. */
export function resetAgentTitlePolicyForTests(): void {
    hubPreference = undefined
}

export function getAgentTitlePolicy(
    env: NodeJS.ProcessEnv = process.env
): AgentTitlePolicy {
    const raw = env.HAPI_AGENT_TITLE_POLICY
    if (raw !== undefined && raw !== '') {
        const normalized = raw.trim().toLowerCase()
        if (normalized === 'name_once' || normalized === 'name-once' || normalized === 'once') {
            return 'name_once'
        }
        return 'allow_rename'
    }
    return hubPreference === 'name_once' ? 'name_once' : 'allow_rename'
}

export function isNameOnceAgentTitlePolicy(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    return getAgentTitlePolicy(env) === 'name_once'
}

/** Shared sparing / name-once steer body (tool name filled by caller). */
export function buildAgentTitleSteer(toolName: string, env: NodeJS.ProcessEnv = process.env): string {
    if (isNameOnceAgentTitlePolicy(env)) {
        return [
            `If the session already has a title, do not call "${toolName}".`,
            `Only when the session is still untitled, call "${toolName}" once after the user's initial request is clear, and set a concise task title.`,
            'Do not rename later for progress, substeps, wording polish, or objective drift — the hub locks the first title.'
        ].join(' ')
    }
    return [
        `Use the title tool sparingly. For a new chat, call the tool "${toolName}" once after the user's initial request is clear, and set a concise task title.`,
        'Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording.',
        'Rename only when the user\'s primary objective changes substantially and the existing title would be misleading.'
    ].join(' ')
}
