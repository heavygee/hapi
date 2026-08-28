import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
    CREATABLE_AGENT_FLAVORS,
    getPermissionModeOptionsForFlavor,
    type AgentFlavor,
    type PermissionMode
} from '@hapi/protocol'
import type { UpdateHubSettingsRequest } from '@hapi/protocol/apiTypes'
import type { ResolvedPeerSpawnDefaults } from '@hapi/protocol/peerSpawnDefaults'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { isDefaultNamespaceToken } from '@/lib/tokenNamespace'
import { useFeatures, usePatchFeatures } from '@/hooks/queries/useFeatures'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsLinkRow, SettingsPageContent, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
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
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const isOwner = getNamespace(token) === 'default'
    const showRunnerManagement = isDefaultNamespaceToken(token)
    const { features } = useFeatures(api)
    const { setGithubPrAwareness, isPending } = usePatchFeatures(api)
    const awareness = features?.githubPrAwareness
    const envPinned = awareness?.source === 'env'
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
        mutationFn: async (patch: UpdateHubSettingsRequest) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateHubSettings(patch)
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
        },
    })

    const {
        operatorDockEnabled,
        awaitingGateSecret,
        gateDraft,
        gateError,
        gateBusy,
        setGateDraft,
        setOperatorDockEnabled,
        submitGateSecret,
        cancelGateSecret
    } = useOperatorDock()
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

    const peerDefaults = hubSettingsQuery.data?.peerSpawnDefaults
    const agentOptions = CREATABLE_AGENT_FLAVORS.map((value) => ({ value, label: value }))
    const permissionOptions = getPermissionModeOptionsForFlavor(peerDefaults?.agent).map((option) => ({
        value: option.mode,
        label: option.label
    }))

    function updatePeerSpawnDefaults(next: ResolvedPeerSpawnDefaults) {
        if (hubSettingsMutation.isPending) return
        hubSettingsMutation.mutate({
            peerSpawnDefaults: {
                agent: next.agent,
                permissionMode: next.permissionMode,
                models: next.models
            }
        })
    }

    const currentModel = peerDefaults?.models[peerDefaults.agent] ?? ''

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
                        <>
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryContract')}
                                description={t('settings.general.sessionSummaryContract.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryContract}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryContract: checked })
                                }}
                            />
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryInChat')}
                                description={t('settings.general.sessionSummaryInChat.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryInChat}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryInChat: checked })
                                }}
                            />
                            {peerDefaults ? (
                                <>
                                    <SettingsChoiceGroup
                                        hideLabel
                                        label={t('settings.general.peerSpawn.agent')}
                                        description={t('settings.general.peerSpawn.agent.desc')}
                                        value={peerDefaults.agent}
                                        options={agentOptions}
                                        columns={5}
                                        onChange={(agent) => {
                                            updatePeerSpawnDefaults({
                                                ...peerDefaults,
                                                agent: agent as AgentFlavor
                                            })
                                        }}
                                    />
                                    <SettingsChoiceGroup
                                        hideLabel
                                        label={t('settings.general.peerSpawn.permissionMode')}
                                        description={t('settings.general.peerSpawn.permissionMode.desc')}
                                        value={peerDefaults.permissionMode}
                                        options={permissionOptions}
                                        columns={4}
                                        onChange={(permissionMode) => {
                                            updatePeerSpawnDefaults({
                                                ...peerDefaults,
                                                permissionMode: permissionMode as PermissionMode
                                            })
                                        }}
                                    />
                                    <SettingsRow label={t('settings.general.peerSpawn.model')} description={t('settings.general.peerSpawn.model.desc')}>
                                        <input
                                            key={`${peerDefaults.agent}:${currentModel}`}
                                            type="text"
                                            defaultValue={currentModel}
                                            onBlur={(event) => {
                                                const model = event.target.value.trim()
                                                if (!model || model === currentModel) return
                                                updatePeerSpawnDefaults({
                                                    ...peerDefaults,
                                                    models: {
                                                        ...peerDefaults.models,
                                                        [peerDefaults.agent]: model
                                                    }
                                                })
                                            }}
                                            className="w-full max-w-xs rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]"
                                        />
                                    </SettingsRow>
                                </>
                            ) : null}
                        </>
                    ) : null}
                    {showOperatorDockSwitch ? (
                        <>
                            <SettingsSwitch
                                label={t('settings.general.operatorDock')}
                                description={t('settings.general.operatorDock.desc')}
                                checked={operatorDockEnabled}
                                onChange={setOperatorDockEnabled}
                            />
                            {awaitingGateSecret ? (
                                <div className="space-y-2 border-t border-[var(--app-border)] px-3 py-3">
                                    <label className="block text-sm text-[var(--app-fg)]" htmlFor="operator-dock-gate-secret">
                                        {t('settings.general.operatorDock.gateLabel')}
                                    </label>
                                    <p className="text-xs text-[var(--app-muted)]">
                                        {t('settings.general.operatorDock.gateHint')}
                                    </p>
                                    <input
                                        id="operator-dock-gate-secret"
                                        type="password"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={gateDraft}
                                        disabled={gateBusy}
                                        onChange={(event) => setGateDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault()
                                                void submitGateSecret()
                                            }
                                        }}
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 font-mono text-sm text-[var(--app-fg)]"
                                        aria-invalid={Boolean(gateError)}
                                    />
                                    {gateError ? (
                                        <p className="text-sm text-red-500" role="alert">{gateError}</p>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={gateBusy || !gateDraft.trim()}
                                            onClick={() => void submitGateSecret()}
                                            className="rounded-md bg-[var(--app-link)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                                        >
                                            {t('settings.general.operatorDock.gateSubmit')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={gateBusy}
                                            onClick={cancelGateSecret}
                                            className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)]"
                                        >
                                            {t('settings.general.operatorDock.gateCancel')}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </>
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
