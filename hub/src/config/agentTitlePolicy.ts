import type { AgentTitlePolicy } from '@hapi/protocol'
import {
    getSettingsFile,
    readSettingsOrThrowCached,
    updateSettings,
    type Settings
} from './settings'
import { setNameOnceTitlePolicyEnabled } from '../store/sessionTitleLock'

const DEFAULT_POLICY: AgentTitlePolicy = 'allow_rename'

export function normalizeAgentTitlePolicy(value: unknown): AgentTitlePolicy {
    return value === 'name_once' ? 'name_once' : DEFAULT_POLICY
}

export function agentTitlePolicyFromSettings(settings: Settings): AgentTitlePolicy {
    return normalizeAgentTitlePolicy(settings.agentTitlePolicy)
}

/** Keep store title-lock helpers in sync with the persisted hub setting. */
export function applyAgentTitlePolicyRuntime(policy: AgentTitlePolicy): void {
    setNameOnceTitlePolicyEnabled(policy === 'name_once')
}

export async function readAgentTitlePolicy(dataDir: string): Promise<AgentTitlePolicy> {
    const settings = await readSettingsOrThrowCached(getSettingsFile(dataDir))
    const policy = agentTitlePolicyFromSettings(settings)
    applyAgentTitlePolicyRuntime(policy)
    return policy
}

export async function writeAgentTitlePolicy(
    dataDir: string,
    policy: AgentTitlePolicy
): Promise<AgentTitlePolicy> {
    const normalized = normalizeAgentTitlePolicy(policy)
    const result = await updateSettings(getSettingsFile(dataDir), (current) => {
        const settings: Settings = {
            ...current,
            agentTitlePolicy: normalized
        }
        return {
            settings,
            result: agentTitlePolicyFromSettings(settings)
        }
    })
    applyAgentTitlePolicyRuntime(result)
    return result
}
