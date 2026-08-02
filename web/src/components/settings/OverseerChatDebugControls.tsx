import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import type { OverseerBrainProfileInfo, OverseerConverseMessage, OverseerConverseResponse, OverseerToolTraceEntry } from '@hapi/protocol'

type ChatTurn = {
    role: 'operator' | 'overseer'
    content: string
    toolTrace?: OverseerToolTraceEntry[]
    brainOnline?: boolean
}

// Text transport for the modality-agnostic Overseer converse core.
// Durable memory is hub-owned (`convo_turn` events); this panel hydrates on open
// and sends only the latest operator line — voice/XR reuse the same core.
const STARTER_QUESTIONS = [
    'What needs my attention?',
    'Which agents are blocked?',
    "What's everyone working on right now?",
    'Anything need a decision from me?'
]

export function OverseerChatDebugControls() {
    const { api } = useAppContext()
    const [open, setOpen] = useState(false)
    const [turns, setTurns] = useState<ChatTurn[]>([])
    const [hydrating, setHydrating] = useState(false)
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [model, setModel] = useState<string | null>(null)
    const [profiles, setProfiles] = useState<OverseerBrainProfileInfo[]>([])
    const [selectedProfile, setSelectedProfile] = useState('default')
    const [models, setModels] = useState<string[]>([])
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const [selectedModel, setSelectedModel] = useState('')
    const scrollRef = useRef<HTMLDivElement>(null)
    const hydrateGenRef = useRef(0)

    useEffect(() => {
        if (!open || !api || profiles.length > 0) return
        void api.fetchOverseerBrains()
            .then((res) => {
                setProfiles(res.profiles)
                // Prefer hub active brain — do not stick on hard-coded "default" when
                // the operator saved a working profile (e.g. local loopback).
                if (res.active?.profile) {
                    setSelectedProfile(res.active.profile)
                    setSelectedModel(res.active.model ?? '')
                }
            })
            .catch(() => { /* brains list is optional chrome */ })
    }, [open, api, profiles.length])

    // Rehydrate from hub every time the panel opens (other transports may have
    // written turns while closed). Block send until this settles. Skip while a
    // converse request is in flight so reopening does not wipe the operator turn.
    useEffect(() => {
        if (!open || !api || loading) return
        const gen = ++hydrateGenRef.current
        let cancelled = false
        setHydrating(true)
        void api.fetchOverseerConverseRecent(24)
            .then((res) => {
                if (cancelled || gen !== hydrateGenRef.current) return
                const next: ChatTurn[] = []
                for (const turn of res.turns) {
                    if (turn.operatorText.trim()) {
                        next.push({ role: 'operator', content: turn.operatorText })
                    }
                    if (turn.overseerText.trim()) {
                        next.push({
                            role: 'overseer',
                            content: turn.overseerText,
                            toolTrace: turn.toolCalls.map((t) => ({
                                tool: t.tool,
                                args: t.argsSummary ? safeJsonArgs(t.argsSummary) : {},
                                ok: true
                            }))
                        })
                    }
                }
                setTurns(next)
                requestAnimationFrame(() => {
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
                })
            })
            .catch(() => { /* empty local view; hub still owns memory on send */ })
            .finally(() => {
                if (!cancelled && gen === hydrateGenRef.current) setHydrating(false)
            })
        return () => { cancelled = true }
    }, [open, api, loading])

    // Populate the model dropdown live from the selected profile's endpoint
    // (server proxies GET /models so the api key never reaches the browser).
    useEffect(() => {
        if (!open || !api || !selectedProfile) return
        let cancelled = false
        setModelsLoading(true)
        setModelsError(null)
        setSelectedModel('')
        void api.fetchOverseerBrainModels(selectedProfile)
            .then((res) => {
                if (cancelled) return
                setModels(res.models)
                if (res.error) setModelsError(res.error)
            })
            .catch((err) => { if (!cancelled) setModelsError(err instanceof Error ? err.message : 'model list failed') })
            .finally(() => { if (!cancelled) setModelsLoading(false) })
        return () => { cancelled = true }
    }, [open, api, selectedProfile])

    const profileDefaultModel = profiles.find((p) => p.id === selectedProfile)?.model ?? null
    const sendBlocked = loading || hydrating

    const send = useCallback(async (text: string) => {
        const trimmed = text.trim()
        if (!trimmed || !api || sendBlocked) return
        setError(null)
        setInput('')

        // Hub owns prior context — send only the new operator line.
        const nextHistory: OverseerConverseMessage[] = [{ role: 'operator', content: trimmed }]
        setTurns((prev) => [...prev, { role: 'operator', content: trimmed }])
        setLoading(true)
        try {
            const res = await api.overseerConverse(nextHistory, {
                profile: selectedProfile,
                model: selectedModel || undefined
            }) as OverseerConverseResponse
            setModel(res.model)
            setTurns((prev) => [...prev, {
                role: 'overseer',
                content: res.reply,
                toolTrace: res.toolTrace,
                brainOnline: res.brainOnline
            }])
            requestAnimationFrame(() => {
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Converse failed')
        } finally {
            setLoading(false)
        }
    }, [api, sendBlocked, selectedProfile, selectedModel])

    return (
        <div className="border-t border-[var(--app-divider)]">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                aria-expanded={open}
            >
                <span className="text-[var(--app-fg)]">Talk to the Overseer (text · debug)</span>
                <span className="text-xs text-[var(--app-hint)]">{model ?? 'brain'}</span>
            </button>
            {open && (
                <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)]/40 px-3 py-2">
                    <p className="text-xs text-[var(--app-hint)]">
                        Fleet chief-of-staff (Stage 1.5 — read + dispositions + relay). Hub-owned memory via convo_turns — reload keeps the thread. The brain can read fleet state, record operator-directed dispositions (done / dismiss / snooze / open), and relay a message to a worker when you explicitly ask (ping / tell / snooze…).
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                        {profiles.length > 1 ? (
                            <label className="flex items-center gap-1 text-[11px] text-[var(--app-hint)]">
                                Brain
                                <select
                                    value={selectedProfile}
                                    onChange={(e) => setSelectedProfile(e.target.value)}
                                    disabled={loading}
                                    className="rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-1 py-0.5 text-[11px] text-[var(--app-fg)] disabled:opacity-50"
                                >
                                    {profiles.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.isDefault ? `Local (${p.model})` : p.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                        <label className="flex items-center gap-1 text-[11px] text-[var(--app-hint)]">
                            Model
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                disabled={loading || modelsLoading}
                                className="max-w-[14rem] rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-1 py-0.5 text-[11px] text-[var(--app-fg)] disabled:opacity-50"
                            >
                                <option value="">
                                    {modelsLoading
                                        ? 'loading…'
                                        : `Default${profileDefaultModel ? ` (${profileDefaultModel})` : ''}`}
                                </option>
                                {models.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                        {modelsError ? (
                            <span className="text-[10px] text-amber-500">models: {modelsError}</span>
                        ) : (
                            <span className="text-[10px] text-[var(--app-hint)]">Per-request — no hub restart.</span>
                        )}
                    </div>

                    <div ref={scrollRef} className="max-h-80 space-y-2 overflow-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                        {turns.length === 0 ? (
                            <div className="space-y-2 p-1">
                                <p className="text-xs text-[var(--app-hint)]">Ask the Overseer about your fleet. Try:</p>
                                <div className="flex flex-wrap gap-1">
                                    {STARTER_QUESTIONS.map((q) => (
                                        <button
                                            key={q}
                                            type="button"
                                            disabled={sendBlocked}
                                            onClick={() => void send(q)}
                                            className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[11px] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            turns.map((turn, idx) => (
                                <div key={idx} className={turn.role === 'operator' ? 'text-right' : 'text-left'}>
                                    <div
                                        className={
                                            'inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] leading-snug ' +
                                            (turn.role === 'operator'
                                                ? 'bg-[var(--app-chat-user-bg)] text-[var(--app-fg)]'
                                                : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]')
                                        }
                                    >
                                        <p className="whitespace-pre-wrap">{turn.content}</p>
                                        {turn.role === 'overseer' && turn.brainOnline === false ? (
                                            <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-500">brain offline</p>
                                        ) : null}
                                        {turn.role === 'overseer' && turn.toolTrace && turn.toolTrace.length > 0 ? (
                                            <details className="mt-1 text-left">
                                                <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {turn.toolTrace.length} tool call{turn.toolTrace.length === 1 ? '' : 's'}
                                                </summary>
                                                <ul className="mt-1 space-y-0.5">
                                                    {turn.toolTrace.map((tt, i) => (
                                                        <li key={i} className="font-mono text-[10px] text-[var(--app-hint)]">
                                                            <span className={tt.ok ? 'text-emerald-500' : 'text-red-500'}>{tt.ok ? '✓' : '✗'}</span>{' '}
                                                            {tt.tool}({Object.keys(tt.args).length ? JSON.stringify(tt.args) : ''})
                                                            {tt.error ? ` — ${tt.error}` : ''}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </details>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        )}
                        {hydrating ? <p className="px-1 text-xs text-[var(--app-hint)]">Loading hub thread…</p> : null}
                        {loading ? <p className="px-1 text-xs text-[var(--app-hint)]">Overseer is thinking…</p> : null}
                    </div>

                    {error ? <p className="text-xs text-red-500">{error}</p> : null}

                    <form
                        onSubmit={(e) => { e.preventDefault(); void send(input) }}
                        className="flex items-center gap-2"
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={hydrating ? 'Loading thread…' : 'Ask the Overseer…'}
                            disabled={sendBlocked}
                            className="flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-[13px] text-[var(--app-fg)] disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={sendBlocked || input.trim().length === 0}
                            className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-bg)] disabled:opacity-50"
                        >
                            Send
                        </button>
                        {turns.length > 0 ? (
                            <button
                                type="button"
                                disabled={sendBlocked}
                                title="Clears this view only — hub convo_turn memory remains"
                                onClick={() => { setTurns([]); setError(null) }}
                                className="rounded-md border border-[var(--app-border)] px-2 py-1.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-bg)] disabled:opacity-50"
                            >
                                Clear
                            </button>
                        ) : null}
                    </form>
                </div>
            )}
        </div>
    )
}

function safeJsonArgs(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(raw)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : { raw }
    } catch {
        return { raw }
    }
}
