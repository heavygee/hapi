import type { FleetUpgradePolicy } from '@hapi/protocol/upgradeChannel'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { useUpgradeInfo, useSetFleetUpgradePolicy } from '@/hooks/queries/useUpgradeInfo'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { queryKeys } from '@/lib/query-keys'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

function getNamespace(token: string | null): string | null {
    if (!token) return null
    try {
        const payload = token.split('.')[1]
        if (!payload) return null
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
        const decoded = JSON.parse(atob(base64)) as { ns?: unknown }
        return typeof decoded.ns === 'string' ? decoded.ns : null
    } catch {
        return null
    }
}

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api, baseUrl, token } = useAppContext()
    const queryClient = useQueryClient()
    const isOwner = getNamespace(token) === 'default'
    const { info } = useUpgradeInfo(api)
    const setPolicy = useSetFleetUpgradePolicy(api)
    const policy: FleetUpgradePolicy = info?.policy ?? 'auto'

    const hubSettingsQuery = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getHubSettings()
        },
        enabled: Boolean(api) && isOwner,
        staleTime: 30_000,
        retry: false,
    })

    const hubSettingsMutation = useMutation({
        mutationFn: async (sessionSummaryContract: boolean) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateHubSettings({ sessionSummaryContract })
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
        },
    })

    const policyOptions: ReadonlyArray<{ value: FleetUpgradePolicy; label: string; description?: string }> = [
        { value: 'silent', label: t('settings.general.runnerMgmt.policySilent'), description: t('settings.general.runnerMgmt.policySilentHint') },
        { value: 'alert', label: t('settings.general.runnerMgmt.policyAlert'), description: t('settings.general.runnerMgmt.policyAlertHint') },
        { value: 'auto', label: t('settings.general.runnerMgmt.policyAuto'), description: t('settings.general.runnerMgmt.policyAutoHint') },
    ]

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            {isOwner ? (
                <SettingsSection title={t('settings.general.agents.title')} description={t('settings.general.agents.description')}>
                    {hubSettingsQuery.data ? (
                        <SettingsSwitch
                            label={t('settings.general.sessionSummaryContract')}
                            description={t('settings.general.sessionSummaryContract.desc')}
                            checked={hubSettingsQuery.data.sessionSummaryContract}
                            onChange={(checked) => {
                                if (hubSettingsMutation.isPending) return
                                hubSettingsMutation.mutate(checked)
                            }}
                        />
                    ) : null}
                </SettingsSection>
            ) : null}
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
            <SettingsSection title={t('settings.general.runnerMgmt.title')} description={t('settings.general.runnerMgmt.body')}>
                <SettingsChoiceGroup
                    label={t('settings.general.runnerMgmt.policyLabel')}
                    value={policy}
                    options={policyOptions}
                    columns={3}
                    onChange={(value) => setPolicy.mutate(value)}
                />
                <SettingsRow
                    label={t('settings.general.runnerMgmt.optOutLabel')}
                    description={t('settings.general.runnerMgmt.optOutBody')}
                />
            </SettingsSection>
        </SettingsPageContent>
    )
}
