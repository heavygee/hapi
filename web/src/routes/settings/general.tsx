import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { useFeatures, usePatchFeatures } from '@/hooks/queries/useFeatures'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { disableAllFue, enableAllFue, isFueDisabledGlobally } from '@/lib/use-fue'
import { queryKeys } from '@/lib/query-keys'
import { useOperatorDock } from '@/hooks/useOperatorDock'

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
    const { features } = useFeatures(api)
    const { setGithubPrAwareness, isPending } = usePatchFeatures(api)
    const awareness = features?.githubPrAwareness
    const envPinned = awareness?.source === 'env'
    // Mirrors the escape hatch on any single FueCallout ("don't show tips
    // like this again") — this is the same hapi.fue.v1.disabled flag,
    // surfaced here for operators who want to flip it back on, or who
    // prefer finding it in Settings over a popover link. See use-fue.ts.
    const [onboardingTipsEnabled, setOnboardingTipsEnabled] = useState(() => !isFueDisabledGlobally())

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

    const { operatorDockEnabled, setOperatorDockEnabled } = useOperatorDock()
    const inlineConfigQuery = useQuery({
        queryKey: ['hapi-inline-config'],
        queryFn: async () => {
            const res = await fetch('/hapi/config', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            })
            if (!res.ok) return { enabled: false }
            const body = await res.json() as { hapiInline?: { enabled?: unknown }, operatorMic?: { enabled?: unknown } }
            const inline = body.hapiInline ?? body.operatorMic
            return { enabled: inline?.enabled === true }
        },
        enabled: isOwner,
        staleTime: 30_000,
        retry: false
    })
    const showOperatorDockSwitch = isOwner && inlineConfigQuery.data?.enabled === true

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />

                <SettingsSwitch
                    label={t('settings.general.githubPrAwareness')}
                    description={envPinned
                        ? t('settings.general.githubPrAwareness.envPinned')
                        : t('settings.general.githubPrAwareness.desc')}
                    checked={Boolean(awareness?.enabled)}
                    onChange={(checked) => {
                        if (envPinned || isPending) return
                        void setGithubPrAwareness(checked)
                    }}
                />
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
                    {showOperatorDockSwitch ? (
                        <SettingsSwitch
                            label={t('settings.general.operatorDock')}
                            description={t('settings.general.operatorDock.desc')}
                            checked={operatorDockEnabled}
                            onChange={setOperatorDockEnabled}
                        />
                    ) : null}
                </SettingsSection>
            ) : null}
            <SettingsSection title={t('settings.onboarding.title')}>
                <SettingsSwitch
                    label={t('settings.onboarding.toggle.label')}
                    description={t('settings.onboarding.toggle.description')}
                    checked={onboardingTipsEnabled}
                    onChange={(checked) => {
                        setOnboardingTipsEnabled(checked)
                        if (checked) {
                            enableAllFue()
                        } else {
                            disableAllFue()
                        }
                    }}
                />
            </SettingsSection>
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
