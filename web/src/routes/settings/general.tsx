import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { useFeatures, usePatchFeatures } from '@/hooks/queries/useFeatures'
import { isDefaultNamespaceToken } from '@/lib/tokenNamespace'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsLinkRow, SettingsPageContent, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { disableAllFue, enableAllFue, isFueDisabledGlobally } from '@/lib/use-fue'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api, baseUrl, token } = useAppContext()
    const navigate = useNavigate()
    const showRunnerManagement = isDefaultNamespaceToken(token)
    const { features } = useFeatures(api)
    const { setGithubPrAwareness, isPending } = usePatchFeatures(api)
    const awareness = features?.githubPrAwareness
    const envPinned = awareness?.source === 'env'
    // Mirrors the escape hatch on any single FueCallout ("don't show tips
    // like this again") — this is the same hapi.fue.v1.disabled flag,
    // surfaced here for operators who want to flip it back on, or who
    // prefer finding it in Settings over a popover link. See use-fue.ts.
    const [onboardingTipsEnabled, setOnboardingTipsEnabled] = useState(() => !isFueDisabledGlobally())

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
            {showRunnerManagement ? (
                <SettingsSection>
                    <SettingsLinkRow
                        label={t('settings.runnerMgmt.title')}
                        description={t('settings.runnerMgmt.linkHint')}
                        onClick={() => navigate({ to: '/settings/general/runners' })}
                    />
                </SettingsSection>
            ) : null}
        </SettingsPageContent>
    )
}
