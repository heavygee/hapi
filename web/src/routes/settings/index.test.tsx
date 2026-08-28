import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import SettingsHubPage from './index'
import SettingsGeneralPage from './general'
import SettingsRunnerManagementPage from './runner-management'
import SettingsDisplayPage from './display'
import SettingsChatPage from './chat'
import SettingsAboutPage from './about'
import SettingsVoicePage from './voice'
import SettingsVoiceVoicesPage from './voice-voices'
import SettingsVoiceAdvancedPage from './voice-advanced'

const { context, navigate, setAppearance, setColorTheme, setFontScale, setTerminalFontSize, setComposerEnterBehavior, setCodexExplorationCollapsed, setVoice, setFleetPolicy } = vi.hoisted(() => ({
    context: { token: '' },
    navigate: vi.fn(),
    setAppearance: vi.fn(),
    setColorTheme: vi.fn(),
    setFontScale: vi.fn(),
    setTerminalFontSize: vi.fn(),
    setComposerEnterBehavior: vi.fn(),
    setCodexExplorationCollapsed: vi.fn(),
    setVoice: vi.fn(),
    setFleetPolicy: vi.fn(),
}))

const getHubSettings = vi.fn().mockResolvedValue({ sessionSummaryContract: false })
const updateHubSettings = vi.fn().mockResolvedValue({ sessionSummaryContract: true })

vi.mock('@/hooks/useColorTheme', () => ({
    useColorTheme: () => ({ colorTheme: 'default', setColorTheme }),
    getColorThemeOptions: () => [
        { value: 'default', labelKey: 'settings.display.colorTheme.default' },
        { value: 'nord', labelKey: 'settings.display.colorTheme.nord' },
    ],
    getColorThemePreview: (theme: string) => theme === 'nord'
        ? { light: '#eceff4', dark: '#2e3440', accent: '#88c0d0' }
        : { light: '#ffffff', dark: '#1c1c1e', accent: '#111827' },
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    Navigate: ({ to, replace }: { to: string; replace?: boolean }) => {
        navigate({ to, replace: Boolean(replace) })
        return null
    },
}))

// About still mounts Overseer debug panels that call useAppContext; this suite only
// asserts metadata, so stub the panels instead of wiring a full AppContext.
vi.mock('@/components/settings/EventsDebugControls', () => ({ EventsDebugControls: () => null }))
vi.mock('@/components/settings/InboxDebugControls', () => ({ InboxDebugControls: () => null }))
vi.mock('@/components/settings/OverseerChatDebugControls', () => ({ OverseerChatDebugControls: () => null }))

vi.mock('@hapi/protocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@hapi/protocol')>()
    return { ...actual, PROTOCOL_VERSION: 1 }
})

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: null, token: context.token }),
}))

vi.mock('@/hooks/queries/useFeatures', () => ({
    useFeatures: () => ({
        features: { githubPrAwareness: { enabled: false, source: 'default' } },
        isLoading: false,
        error: null,
        refetch: async () => undefined,
    }),
    usePatchFeatures: () => ({
        setGithubPrAwareness: vi.fn(),
        isPending: false,
    }),
}))

vi.mock('@/hooks/queries/useUpgradeInfo', () => ({
    useUpgradeInfo: () => ({ info: null, isLoading: false }),
    useSetFleetUpgradePolicy: () => ({ mutate: setFleetPolicy }),
}))

vi.mock('@/hooks/useTheme', () => ({
    useAppearance: () => ({ appearance: 'system', setAppearance }),
    getAppearanceOptions: () => [
        { value: 'system', labelKey: 'settings.display.appearance.system' },
        { value: 'dark', labelKey: 'settings.display.appearance.dark' },
        { value: 'oled', labelKey: 'settings.display.appearance.oled' },
        { value: 'light', labelKey: 'settings.display.appearance.light' },
    ],
}))

vi.mock('@/hooks/useFontScale', () => ({
    useFontScale: () => ({ fontScale: 1, setFontScale }),
    getFontScaleOptions: () => [
        { value: 0.8, label: '80%' }, { value: 0.9, label: '90%' }, { value: 1, label: '100%' },
        { value: 1.1, label: '110%' }, { value: 1.2, label: '120%' },
    ],
}))

vi.mock('@/hooks/useTerminalFontSize', () => ({
    useTerminalFontSize: () => ({ terminalFontSize: 13, setTerminalFontSize }),
    getTerminalFontSizeOptions: () => [
        { value: 9, label: '9px' }, { value: 11, label: '11px' }, { value: 13, label: '13px' },
        { value: 15, label: '15px' }, { value: 17, label: '17px' },
    ],
}))

vi.mock('@/hooks/useSessionListStatusMode', () => ({
    useSessionListStatusMode: () => ({ sessionListStatusMode: 'standard', setSessionListStatusMode: vi.fn() }),
    getSessionListStatusModeOptions: () => [
        { value: 'standard', labelKey: 'settings.display.sessionListStatus.standard' },
        { value: 'detailed', labelKey: 'settings.display.sessionListStatus.detailed' },
    ],
}))

vi.mock('@/hooks/useShowActiveSessionsOnly', () => ({
    useShowActiveSessionsOnly: () => ({ showActiveSessionsOnly: false, setShowActiveSessionsOnly: vi.fn() }),
}))

vi.mock('@/hooks/usePinInProgressSessions', () => ({
    usePinInProgressSessions: () => ({
        pinInProgressMode: 'off' as const,
        setPinInProgressMode: vi.fn(),
        pinInProgressSessions: false,
        setPinInProgressSessions: vi.fn(),
    }),
}))

vi.mock('@/hooks/useSessionHeaderMetadata', () => ({
    useSessionHeaderMetadata: () => ({
        preferences: {
            showLabels: true,
            agent: true,
            model: true,
            reasoning: true,
            fastMode: true,
            machine: true,
            lastActive: true,
            createdAt: false,
            updatedAt: false,
            worktree: true,
        },
        setPreference: vi.fn(),
    }),
}))

vi.mock('@/hooks/useSessionPreviewLimit', () => ({
    MIN_SESSION_PREVIEW_LIMIT: 1,
    MAX_SESSION_PREVIEW_LIMIT: 99,
    normalizeSessionPreviewLimit: (value: number) => Math.max(1, Math.min(99, Math.round(value))),
    useSessionPreviewLimit: () => ({ sessionPreviewLimit: 8, setSessionPreviewLimit: vi.fn() }),
}))

vi.mock('@/hooks/useThemeColors', () => ({
    useThemeColors: () => ({
        keys: [],
        getPickerValue: vi.fn(),
        isCustomized: vi.fn(() => false),
        hasAnyCustom: false,
        setColor: vi.fn(),
        resetColor: vi.fn(),
        resetAll: vi.fn(),
    }),
}))

vi.mock('@/hooks/useComposerEnterBehavior', () => ({
    useComposerEnterBehavior: () => ({ composerEnterBehavior: 'send', setComposerEnterBehavior }),
    getComposerEnterBehaviorOptions: () => [
        { value: 'send', labelKey: 'settings.chat.enterBehavior.send' },
        { value: 'newline', labelKey: 'settings.chat.enterBehavior.newline' },
    ],
}))

vi.mock('@/hooks/useTerminalToolDisplayMode', () => ({
    useTerminalToolDisplayMode: () => ({ terminalToolDisplayMode: 'compact', setTerminalToolDisplayMode: vi.fn() }),
    getTerminalToolDisplayModeOptions: () => [
        { value: 'compact', labelKey: 'settings.chat.terminalToolDisplay.compact' },
        { value: 'detailed', labelKey: 'settings.chat.terminalToolDisplay.detailed' },
    ],
}))

vi.mock('@/hooks/useCodexExplorationCollapse', () => ({
    useCodexExplorationCollapse: () => ({ codexExplorationCollapsed: true, setCodexExplorationCollapsed }),
}))

vi.mock('@/hooks/useChatSurfaceColors', () => ({
    useChatSurfaceColors: () => ({
        toolGroupBackground: 'default',
        userMessageBackground: 'preset:soft-blue',
        setToolGroupBackground: vi.fn(),
        setUserMessageBackground: vi.fn(),
    }),
    getChatSurfaceColorPresetOptions: () => [
        { value: 'default', labelKey: 'settings.chat.surfaceColor.default' },
        { value: 'soft-blue', labelKey: 'settings.chat.surfaceColor.softBlue' },
    ],
    getChatSurfaceColorPickerValue: () => '#7db7ff',
    toPresetChatSurfaceColorPreference: (value: string) => value === 'default' ? 'default' : `preset:${value}`,
    toCustomChatSurfaceColorPreference: (value: string) => `custom:${value}`,
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            getSessions: vi.fn(async () => ({ sessions: [] })),
            setModelErrorAutoBridge: vi.fn(async () => {}),
            getHubSettings,
            updateHubSettings,
        },
        baseUrl: 'http://127.0.0.1:3006',
        token: context.token,
    }),
}))

vi.mock('@/components/settings/CompanionPairing', () => ({
    CompanionPairing: () => <div>Companion pairing</div>,
}))

vi.mock('@/components/settings/VoiceAdvancedControls', () => ({
    VoiceRespondsControls: () => <div>Response length controls</div>,
    VoiceSoundsControls: () => <div>Sound controls</div>,
    VoicePersonaControls: () => <div>Persona controls</div>,
    VoiceDiagnosticsControls: () => <div>Diagnostics controls</div>,
}))

// About mounts Overseer debug panels that call useAppContext; this suite only
// asserts metadata, so stub the panels instead of wiring a full AppContext.
vi.mock('@/components/settings/EventsDebugControls', () => ({ EventsDebugControls: () => null }))
vi.mock('@/components/settings/InboxDebugControls', () => ({ InboxDebugControls: () => null }))

vi.mock('./useVoiceSettings', () => ({
    useVoiceSettings: () => ({
        voiceMode: 'assistant',
        setVoiceMode: vi.fn(),
        providers: [],
        provider: null,
        setProvider: vi.fn(),
        transcriptionMode: 'standard',
        setTranscriptionMode: vi.fn(),
        modes: ['standard'],
        configuredBackends: ['elevenlabs'],
        backend: 'elevenlabs',
        setBackend: vi.fn(),
        voiceId: null,
        setVoice,
        voices: [
            { id: 'voice-1', name: 'Jessica', description: 'Warm', previewUrl: 'https://example.test/voice.mp3', category: 'premade' },
        ],
        voiceLanguage: null,
        setVoiceLanguage: vi.fn(),
        voiceLanguages: [{ code: null, name: 'Auto-detect' }, { code: 'en', name: 'English' }],
        playingVoiceId: null,
        previewVoice: vi.fn(),
    }),
}))

function renderPage(page: React.ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>{page}</I18nProvider>
        </QueryClientProvider>,
    )
}

describe('responsive settings pages', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        getHubSettings.mockResolvedValue({ sessionSummaryContract: false })
        updateHubSettings.mockResolvedValue({ sessionSummaryContract: true })
        context.token = `x.${btoa(JSON.stringify({ ns: 'default' }))}.x`
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"hapi inline disabled"}', {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        }))
    })

    it('renders the mobile hub categories with current summaries', () => {
        renderPage(<SettingsHubPage />)
        expect(screen.getByText('General')).toBeInTheDocument()
        expect(screen.getAllByText('Display').length).toBeGreaterThan(0)
        expect(screen.getByText('Voice, language, and behavior')).toBeInTheDocument()
        expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
    })

    it('navigates from the hub to a category route', () => {
        renderPage(<SettingsHubPage />)
        fireEvent.click(screen.getByRole('button', { name: /General/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/general' })
    })

    it('hides Hub storage from tenant namespaces', () => {
        context.token = `x.${btoa(JSON.stringify({ ns: 'tenant' }))}.x`
        renderPage(<SettingsHubPage />)
        expect(screen.queryByText('Hub database usage')).not.toBeInTheDocument()
    })

    it('changes the application language inline', async () => {
        renderPage(<SettingsGeneralPage />)
        expect(screen.getByText('Companion')).toBeInTheDocument()
        expect(screen.getByText('Companion pairing')).toBeInTheDocument()
        expect(await screen.findByRole('checkbox', { name: 'Ask agents to emit session status summary' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('radio', { name: '简体中文' }))
        expect(localStorage.getItem('hapi-lang')).toBe('zh-CN')
    })

    it('shows an owner-only operator dock switch when /hapi/config is enabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            hapiInline: { enabled: true }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        renderPage(<SettingsGeneralPage />)
        expect(await screen.findByRole('checkbox', { name: 'Show operator tools' })).toBeInTheDocument()
    })

    it('hides the operator dock switch from tenant namespaces', async () => {
        context.token = `x.${btoa(JSON.stringify({ ns: 'tenant' }))}.x`
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            hapiInline: { enabled: true }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        renderPage(<SettingsGeneralPage />)
        expect(await screen.findByText('Companion pairing')).toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: 'Show operator tools' })).not.toBeInTheDocument()
    })

    it('persists operator dock enable via in-page gate field (no window.prompt)', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.includes('/hapi/config')) {
                return new Response(JSON.stringify({ hapiInline: { enabled: true } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            }
            if (url.includes('/hapi/operator/sessions')) {
                return new Response(JSON.stringify({ sessions: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            }
            return new Response('unexpected', { status: 500 })
        })
        const promptSpy = vi.spyOn(window, 'prompt')
        renderPage(<SettingsGeneralPage />)
        const toggle = await screen.findByRole('checkbox', { name: 'Show operator tools' })
        fireEvent.click(toggle)
        const field = await screen.findByLabelText('Operator gate secret')
        fireEvent.change(field, { target: { value: 'gate-secret' } })
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
        await vi.waitFor(() => {
            expect(localStorage.getItem('hapi-operator-dock')).toBe('true')
            expect(localStorage.getItem('hapiInlineSecret')).toBe('gate-secret')
        })
        expect(promptSpy).not.toHaveBeenCalled()
    })

    it('buries runner management behind a link row on General (not a front-and-center switch)', () => {
        renderPage(<SettingsGeneralPage />)
        // The 3-pole switch must NOT be present on the General page itself.
        expect(screen.queryByRole('radio', { name: /Auto-upgrade/ })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Runner management/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/general/runners' })
    })

    it('hides runner management from tenant namespaces on General', () => {
        context.token = `x.${btoa(JSON.stringify({ ns: 'tenant' }))}.x`
        renderPage(<SettingsGeneralPage />)
        expect(screen.queryByRole('button', { name: /Runner management/ })).not.toBeInTheDocument()
    })

    it('renders the 3-pole policy switch on the runner management sub-page', () => {
        renderPage(<SettingsRunnerManagementPage />)
        expect(screen.getByRole('radio', { name: /^No alert/ })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: /^Alert/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('radio', { name: /^Auto-upgrade/ }))
        expect(setFleetPolicy).toHaveBeenCalledWith('auto')
    })

    it('redirects tenant namespaces away from the runner management route', () => {
        context.token = `x.${btoa(JSON.stringify({ ns: 'tenant' }))}.x`
        renderPage(<SettingsRunnerManagementPage />)
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/general', replace: true })
        expect(screen.queryByRole('radio', { name: /^Auto-upgrade/ })).not.toBeInTheDocument()
    })

    it('renders compact display controls without dropdown popovers', () => {
        renderPage(<SettingsDisplayPage />)
        expect(screen.getByRole('radio', { name: 'OLED Black' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('radio', { name: 'Nord' }))
        expect(setColorTheme).toHaveBeenCalledWith('nord')
        expect(screen.getByRole('radio', { name: '120%' })).toBeInTheDocument()
        expect(screen.getByRole('spinbutton', { name: 'Sessions Before Folding' })).toHaveValue(8)
        expect(screen.getByRole('checkbox', { name: 'Show field labels' })).toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Reasoning effort' })).toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Machine' })).toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Active time' })).toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Created time' })).not.toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'Updated time' })).not.toBeChecked()
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('keeps the session status description visible with its choice group', () => {
        renderPage(<SettingsDisplayPage />)

        const description = screen.getByText('Choose which status hints appear in the session list. Basic shows runtime state; Extended also shows permission, input, background-task, new-activity, and scheduled-message hints (clock icon).')
        const choices = screen.getByRole('radiogroup', { name: 'Session list status hints' })
        expect(screen.getByRole('radio', { name: 'Basic' })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Extended' })).toBeInTheDocument()
        expect(description.parentElement?.parentElement).toBe(choices.parentElement)
        expect(description.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps chat enum choices inline', () => {
        renderPage(<SettingsChatPage />)
        fireEvent.click(screen.getByRole('radio', { name: 'Insert newline' }))
        expect(setComposerEnterBehavior).toHaveBeenCalledWith('newline')
        expect(screen.getByText('Grouped Tool Use Background')).toBeInTheDocument()
    })

    it('renders the default-collapse switch for Codex exploration groups', () => {
        renderPage(<SettingsChatPage />)
        const toggle = screen.getByRole('checkbox', { name: 'Collapse explored tool groups by default' })
        expect(toggle).toBeChecked()
        fireEvent.click(toggle)
        expect(setCodexExplorationCollapsed).toHaveBeenCalledWith(false)
    })

    it('renders About metadata on its own route page', () => {
        renderPage(<SettingsAboutPage />)
        expect(screen.queryByText('Companion')).not.toBeInTheDocument()
        expect(screen.getByText('App Version')).toBeInTheDocument()
        expect(screen.getByText(String(__APP_VERSION__))).toBeInTheDocument()
        expect(screen.getByText('Protocol Version')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'hapi.run' })).toHaveAttribute('rel', 'noopener noreferrer')
        // OverseerChatDebugControls is stubbed null in this suite; deep-link to
        // /overseer was removed in favor of the embedded About panel.
    })

    it('links common voice settings to full-page voices and advanced pages', () => {
        renderPage(<SettingsVoicePage />)
        fireEvent.click(screen.getByRole('button', { name: /Voice/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/voice/voices' })
        fireEvent.click(screen.getByRole('button', { name: /Advanced voice settings/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/voice/advanced' })
    })

    it('selects a voice from the full-page picker', () => {
        renderPage(<SettingsVoiceVoicesPage />)
        fireEvent.click(screen.getByRole('radio', { name: /Jessica/ }))
        expect(setVoice).toHaveBeenCalledWith('voice-1')
    })

    it('keeps persona, tuning, and diagnostics on the advanced route page', () => {
        renderPage(<SettingsVoiceAdvancedPage />)
        expect(screen.getByText('Persona controls')).toBeInTheDocument()
        expect(screen.getByText('Sound controls')).toBeInTheDocument()
        expect(screen.getByText('Diagnostics controls')).toBeInTheDocument()
    })
})
