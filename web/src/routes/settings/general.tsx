import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { disableAllFue, enableAllFue, isFueDisabledGlobally } from '@/lib/use-fue'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { baseUrl } = useAppContext()
    // Mirrors the escape hatch on any single FueCallout ("don't show tips
    // like this again") — this is the same hapi.fue.v1.disabled flag,
    // surfaced here for operators who want to flip it back on, or who
    // prefer finding it in Settings over a popover link. See use-fue.ts.
    const [onboardingTipsEnabled, setOnboardingTipsEnabled] = useState(() => !isFueDisabledGlobally())

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
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
        </SettingsPageContent>
    )
}
