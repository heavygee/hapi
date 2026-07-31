import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import type { OverseerBrainProfileInfo } from '@hapi/protocol'

type ActiveBrain = { profile: string; model: string | null }

/**
 * Runtime brain switcher. Unlike the per-request selectors in the talk-to panel (which only
 * affect the next converse call), this persists the hub's *active* brain — the profile/model
 * that voice + converse default to — via PUT /overseer/brain/active. Switchable at whim, no env
 * edit, no hub restart. The api key never reaches the browser (model list is proxied server-side).
 */
export function OverseerBrainPanel() {
    const { api } = useAppContext()
    const [profiles, setProfiles] = useState<OverseerBrainProfileInfo[]>([])
    const [active, setActive] = useState<ActiveBrain | null>(null)
    const [selectedProfile, setSelectedProfile] = useState<string>('default')
    const [selectedModel, setSelectedModel] = useState<string>('')
    const [models, setModels] = useState<string[]>([])
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        if (!api) return
        void api.fetchOverseerBrains()
            .then((res) => {
                setProfiles(res.profiles)
                setActive(res.active)
                setSelectedProfile(res.active?.profile ?? res.profiles.find((p) => p.isDefault)?.id ?? res.profiles[0]?.id ?? 'default')
                setSelectedModel(res.active?.model ?? '')
            })
            .catch((err) => setSaveError(err instanceof Error ? err.message : 'failed to load brains'))
            .finally(() => setLoaded(true))
    }, [api])

    // Live model list for the chosen profile (server proxies GET /models). Also acts as a
    // reachability probe — an error here means the endpoint is offline (GPU pulled for VR, etc.).
    useEffect(() => {
        if (!api || !selectedProfile) return
        let cancelled = false
        setModelsLoading(true)
        setModelsError(null)
        void api.fetchOverseerBrainModels(selectedProfile)
            .then((res) => {
                if (cancelled) return
                setModels(res.models)
                if (res.error) setModelsError(res.error)
            })
            .catch((err) => { if (!cancelled) setModelsError(err instanceof Error ? err.message : 'model list failed') })
            .finally(() => { if (!cancelled) setModelsLoading(false) })
        return () => { cancelled = true }
    }, [api, selectedProfile])

    const profileDefaultModel = profiles.find((p) => p.id === selectedProfile)?.model ?? null

    const activeLabel = active
        ? `${active.profile}${active.model ? ` · ${active.model}` : ' · (profile default)'}`
        : 'env default'

    const isDirty = selectedProfile !== (active?.profile ?? '') || (selectedModel || null) !== (active?.model ?? null)

    const save = useCallback(async () => {
        if (!api || saving) return
        setSaving(true)
        setSaveError(null)
        try {
            const res = await api.setOverseerActiveBrain(selectedProfile, selectedModel || null)
            setActive(res.active)
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'failed to set active brain')
        } finally {
            setSaving(false)
        }
    }, [api, saving, selectedProfile, selectedModel])

    return (
        <div className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40 p-3">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--app-fg)]">Brain</h2>
                <span className="text-xs text-[var(--app-hint)]">
                    active: <span className="font-mono text-[var(--app-fg)]">{activeLabel}</span>
                </span>
            </div>
            <p className="text-xs text-[var(--app-hint)]">
                The active brain is what voice and every converse default to. Switch it at whim — persisted, no hub restart.
                A per-request override in the talk-to panel below still wins for that one call.
            </p>

            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[11px] text-[var(--app-hint)]">
                    Profile
                    <select
                        value={selectedProfile}
                        onChange={(e) => { setSelectedProfile(e.target.value); setSelectedModel('') }}
                        disabled={saving || !loaded}
                        className="rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-[13px] text-[var(--app-fg)] disabled:opacity-50"
                    >
                        {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.isDefault ? `${p.label} · local (${p.model})` : `${p.label} (${p.model})`}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1 text-[11px] text-[var(--app-hint)]">
                    Model
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={saving || modelsLoading}
                        className="max-w-[18rem] rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-[13px] text-[var(--app-fg)] disabled:opacity-50"
                    >
                        <option value="">
                            {modelsLoading ? 'loading…' : `Profile default${profileDefaultModel ? ` (${profileDefaultModel})` : ''}`}
                        </option>
                        {models.map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                </label>

                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || !isDirty || !loaded}
                    className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-xs font-medium text-[var(--app-button-text)] disabled:opacity-50"
                >
                    {saving ? 'Setting…' : isDirty ? 'Set active' : 'Active'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {modelsError ? (
                    <span className="text-amber-500">offline / unreachable: {modelsError}</span>
                ) : modelsLoading ? (
                    <span className="text-[var(--app-hint)]">probing endpoint…</span>
                ) : (
                    <span className="text-emerald-500">endpoint reachable · {models.length} chat model{models.length === 1 ? '' : 's'}</span>
                )}
                {saveError ? <span className="text-red-500">{saveError}</span> : null}
            </div>
        </div>
    )
}
