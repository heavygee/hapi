import { PROTOCOL_VERSION } from '@hapi/protocol'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

export default function SettingsAboutPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    return (
        <SettingsPageContent title={t('settings.about.title')} description={t('settings.about.description')}>
            <SettingsSection>
                <SettingsRow label={t('settings.about.website')} trailing={
                    <a href="https://hapi.run" target="_blank" rel="noopener noreferrer" className="text-[var(--app-link)] hover:underline">hapi.run</a>
                } />
                <SettingsRow label={t('settings.about.appVersion')} trailing={<span className="text-[var(--app-hint)]">{__APP_VERSION__}</span>} />
                <SettingsRow label={t('settings.about.protocolVersion')} trailing={<span className="text-[var(--app-hint)]">{PROTOCOL_VERSION}</span>} />
            </SettingsSection>
            {/* Overseer debug panels (brain switch, talk-to, events, inbox) now live in the dedicated console. */}
            <SettingsSection>
                <button
                    type="button"
                    onClick={() => navigate({ to: '/overseer' })}
                    className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                >
                    <span className="text-[var(--app-fg)]">Overseer console</span>
                    <span className="text-xs text-[var(--app-hint)]">brain · talk-to · debug →</span>
                </button>
            </SettingsSection>
        </SettingsPageContent>
    )
}
