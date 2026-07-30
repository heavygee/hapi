import { useCallback, useRef, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import type { OverseerConverseMessage, OverseerConverseResponse, OverseerToolTraceEntry } from '@hapi/protocol'

type ChatTurn = {
    role: 'operator' | 'overseer'
    content: string
    toolTrace?: OverseerToolTraceEntry[]
    brainOnline?: boolean
}

// Debug-only text transport for the modality-agnostic Overseer converse core.
// This is deliberately a Settings/debug affordance, not a top-level surface:
// voice/XR are the intended first-class modalities and reuse the same
// /api/overseer/converse endpoint. Text is here only to exercise the loop.
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
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [model, setModel] = useState<string | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    const send = useCallback(async (text: string) => {
        const trimmed = text.trim()
        if (!trimmed || !api || loading) return
        setError(null)
        setInput('')

        const history = turns.map((turn): OverseerConverseMessage => ({ role: turn.role, content: turn.content }))
        const nextHistory: OverseerConverseMessage[] = [...history, { role: 'operator', content: trimmed }]
        setTurns((prev) => [...prev, { role: 'operator', content: trimmed }])
        setLoading(true)
        try {
            const res = await api.overseerConverse(nextHistory) as OverseerConverseResponse
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
    }, [api, loading, turns])

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
                        Read-only fleet chief-of-staff (Stage 0). Text transport over the same converse core voice will use. Answers are driven by a local LLM calling read-only overseer tools.
                    </p>

                    <div ref={scrollRef} className="max-h-80 space-y-2 overflow-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                        {turns.length === 0 ? (
                            <div className="space-y-2 p-1">
                                <p className="text-xs text-[var(--app-hint)]">Ask the Overseer about your fleet. Try:</p>
                                <div className="flex flex-wrap gap-1">
                                    {STARTER_QUESTIONS.map((q) => (
                                        <button
                                            key={q}
                                            type="button"
                                            disabled={loading}
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
                            placeholder="Ask the Overseer…"
                            disabled={loading}
                            className="flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-[13px] text-[var(--app-fg)] disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={loading || input.trim().length === 0}
                            className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-bg)] disabled:opacity-50"
                        >
                            Send
                        </button>
                        {turns.length > 0 ? (
                            <button
                                type="button"
                                disabled={loading}
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
