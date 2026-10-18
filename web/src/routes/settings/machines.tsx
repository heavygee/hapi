import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    MACHINE_DISPLAY_NAME_MAX_LENGTH,
    SESSION_START_TIMEOUT_MS_DEFAULT,
    SESSION_START_TIMEOUT_MS_MAX,
    SESSION_START_TIMEOUT_MS_MIN
} from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { getMachineTitle } from '@/hooks/useMachineLabels'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { getNamespaceFromToken } from '@/lib/namespace'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'

const SESSION_START_TIMEOUT_MIN_SECONDS = SESSION_START_TIMEOUT_MS_MIN / 1000
const SESSION_START_TIMEOUT_MAX_SECONDS = SESSION_START_TIMEOUT_MS_MAX / 1000
const SESSION_START_TIMEOUT_DEFAULT_SECONDS = SESSION_START_TIMEOUT_MS_DEFAULT / 1000

function MachineRow(props: { api: ApiClient | null; machine: Machine }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const savingRef = useRef(false)

    const label = getMachineTitle(props.machine)
    const host = props.machine.metadata?.host
    const platform = props.machine.metadata?.platform
    const subtitle = [host, platform].filter(Boolean).join(' · ')

    const renameMutation = useMutation({
        mutationFn: async (displayName: string) => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            await props.api.renameMachine(props.machine.id, displayName)
        },
        onSuccess: () => {
            setEditing(false)
            setError(null)
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        },
        onError: () => setError(t('settings.machines.error')),
    })

    function startEditing() {
        setDraft(props.machine.metadata?.displayName ?? '')
        setError(null)
        setEditing(true)
    }

    function save() {
        // Disabling the focused input on submit forces a blur, so `save` is
        // reached twice for a single Enter. A ref (not `isPending`, which is a
        // render-timing-dependent closure value) keeps that to one request.
        if (savingRef.current) {
            return
        }
        const next = draft.trim()
        if (next === (props.machine.metadata?.displayName ?? '')) {
            setEditing(false)
            return
        }
        savingRef.current = true
        renameMutation.mutate(next, {
            onSettled: () => {
                savingRef.current = false
            },
        })
    }

    return (
        <div className="px-3 py-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            value={draft}
                            maxLength={MACHINE_DISPLAY_NAME_MAX_LENGTH}
                            disabled={renameMutation.isPending}
                            placeholder={host ?? t('settings.machines.namePlaceholder')}
                            aria-label={t('settings.machines.rename', { name: label })}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={save}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    save()
                                } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setEditing(false)
                                    setError(null)
                                }
                            }}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-60"
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={startEditing}
                            aria-label={t('settings.machines.rename', { name: label })}
                            className="block w-full truncate text-left text-sm font-medium text-[var(--app-fg)] hover:text-[var(--app-link)]"
                        >
                            {label}
                        </button>
                    )}
                    {subtitle ? (
                        <div className="mt-0.5 truncate text-xs leading-snug text-[var(--app-hint)]">{subtitle}</div>
                    ) : null}
                </div>
            </div>
            {error ? <div role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
    )
}

/**
 * Session-start timeout (tiann/hapi#2062). Hub-wide, applied by every runner
 * on its next spawn; a runner host that exports
 * HAPI_RUNNER_WEBHOOK_TIMEOUT_MS keeps overriding it.
 */
function SessionStartTimeoutSection(props: { api: ApiClient | null }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const hubSettingsQuery = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!props.api) throw new Error('API unavailable')
            return await props.api.getHubSettings()
        },
        enabled: Boolean(props.api),
        staleTime: 30_000,
        retry: false,
    })

    const configuredMs = hubSettingsQuery.data?.sessionStartTimeoutMs ?? null
    const syncedMsRef = useRef<number | null | undefined>(undefined)

    // Reflect the stored value once it loads, and after a save/reset changes
    // it. Keyed on the value rather than the query object so a background
    // refetch cannot clobber what the user is currently typing.
    useEffect(() => {
        if (!hubSettingsQuery.data) return
        if (syncedMsRef.current === configuredMs) return
        syncedMsRef.current = configuredMs
        setDraft(configuredMs === null ? '' : String(Math.round(configuredMs / 1000)))
    }, [hubSettingsQuery.data, configuredMs])

    const mutation = useMutation({
        mutationFn: async (sessionStartTimeoutMs: number | null) => {
            if (!props.api) throw new Error('API unavailable')
            return await props.api.updateHubSettings({ sessionStartTimeoutMs })
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
            setError(null)
            setSaved(true)
        },
        onError: () => {
            setSaved(false)
            setError(t('settings.machines.sessionStartTimeout.saveFailed'))
        },
    })

    const rangeHint = t('settings.machines.sessionStartTimeout.range', {
        min: String(SESSION_START_TIMEOUT_MIN_SECONDS),
        max: String(SESSION_START_TIMEOUT_MAX_SECONDS),
    })

    function save() {
        const trimmed = draft.trim()
        if (trimmed === '') {
            mutation.mutate(null)
            return
        }
        const seconds = Number(trimmed)
        if (
            !Number.isInteger(seconds)
            || seconds < SESSION_START_TIMEOUT_MIN_SECONDS
            || seconds > SESSION_START_TIMEOUT_MAX_SECONDS
        ) {
            setSaved(false)
            setError(rangeHint)
            return
        }
        mutation.mutate(seconds * 1000)
    }

    return (
        <SettingsSection
            title={t('settings.machines.sessionStartTimeout.title')}
            description={t('settings.machines.sessionStartTimeout.description')}
        >
            <div className="space-y-2 px-3 py-3">
                <label className="block space-y-1">
                    <span className="text-sm font-medium text-[var(--app-fg)]">
                        {t('settings.machines.sessionStartTimeout.label')}
                    </span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={SESSION_START_TIMEOUT_MIN_SECONDS}
                        max={SESSION_START_TIMEOUT_MAX_SECONDS}
                        step={1}
                        value={draft}
                        placeholder={String(SESSION_START_TIMEOUT_DEFAULT_SECONDS)}
                        disabled={mutation.isPending || !hubSettingsQuery.data}
                        onChange={(event) => {
                            setDraft(event.target.value)
                            setError(null)
                            setSaved(false)
                        }}
                        className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] disabled:opacity-60"
                    />
                </label>
                <p className="text-xs leading-snug text-[var(--app-hint)]">{rangeHint}</p>
                <p className="text-xs leading-snug text-[var(--app-hint)]">
                    {t('settings.machines.sessionStartTimeout.envHint')}
                </p>
                {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
                {saved ? <p className="text-xs text-[var(--app-hint)]">{t('settings.machines.sessionStartTimeout.saved')}</p> : null}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" size="sm" disabled={mutation.isPending || !hubSettingsQuery.data} onClick={save}>
                        {t('settings.machines.sessionStartTimeout.save')}
                    </Button>
                    {configuredMs !== null ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() => {
                                setError(null)
                                mutation.mutate(null)
                            }}
                        >
                            {t('settings.machines.sessionStartTimeout.reset')}
                        </Button>
                    ) : null}
                </div>
            </div>
        </SettingsSection>
    )
}

export default function SettingsMachinesPage() {
    const { t } = useTranslation()
    const { api, token } = useAppContext()
    const { machines } = useMachines(api, true)
    // Hub settings are owner-only to write; other namespaces get a 403.
    const isOwner = getNamespaceFromToken(token) === 'default'

    return (
        <SettingsPageContent description={t('settings.machines.description')}>
            <SettingsSection title={t('settings.machines.section')}>
                {machines.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.machines.empty')}</div>
                ) : (
                    machines.map((machine) => (
                        <MachineRow key={machine.id} api={api} machine={machine} />
                    ))
                )}
            </SettingsSection>
            {isOwner ? <SessionStartTimeoutSection api={api} /> : null}
        </SettingsPageContent>
    )
}
