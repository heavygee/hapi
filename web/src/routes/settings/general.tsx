import { useNavigate } from '@tanstack/react-router'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { isDefaultNamespaceToken } from '@/lib/tokenNamespace'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsLinkRow, SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { baseUrl, token } = useAppContext()
    const navigate = useNavigate()
    const showRunnerManagement = isDefaultNamespaceToken(token)

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
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
