import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { useFeatures, usePatchFeatures } from '@/hooks/queries/useFeatures'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api, baseUrl } = useAppContext()
    const { features } = useFeatures(api)
    const { setGithubPrAwareness, isPending } = usePatchFeatures(api)
    const awareness = features?.githubPrAwareness
    const envPinned = awareness?.source === 'env'

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            <SettingsSection title={t('settings.general.githubPrAwareness')}>
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
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
