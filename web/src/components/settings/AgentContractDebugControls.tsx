import { SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { useShowAgentContract } from '@/hooks/useShowAgentContract'
import { useTranslation } from '@/lib/use-translation'

/**
 * Operator debug: leave AGENT_NOTIFY_SUMMARY visible in session chat so
 * emission can be verified without digging in the SQLite store. Default off
 * (Half A strip). Raw messages are never mutated either way.
 */
export function AgentContractDebugControls() {
    const { t } = useTranslation()
    const { showAgentContract, setShowAgentContract } = useShowAgentContract()

    return (
        <SettingsSwitch
            label={t('settings.about.showAgentContract')}
            description={t('settings.about.showAgentContract.desc')}
            checked={showAgentContract}
            onChange={setShowAgentContract}
        />
    )
}
