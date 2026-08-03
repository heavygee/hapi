import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/relative-time'
import { useTranslation } from '@/lib/use-translation'

export type SystemEventRow = {
    id: number
    ts: number
    sourceKind: string
    sourceRef: string | null
    eventType: string
    attentionCandidate: number
    summary: string
    provenance: string | null
    relatedSessionId: string | null
    payloadJson: string | null
    severity: number | null
    artifactRefs?: string | null
}

type SystemEventsResponse = {
    total: number
    events: SystemEventRow[]
}

export function EventsDebugControls() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [total, setTotal] = useState(0)
    const [events, setEvents] = useState<SystemEventRow[]>([])

    const refresh = useCallback(async () => {
        if (!api) {
            setError('Not authenticated')
            return
        }
        setLoading(true)
        setError(null)
        try {
            const data = await api.fetchSystemEvents({ limit: 80 }) as SystemEventsResponse
            // Hub-inferred silence is no longer written; hide historical `stale`
            // rows from this operator-facing debug feed (same rule as Session Log All).
            const visible = data.events.filter((event) => event.eventType !== 'stale')
            setTotal(visible.length)
            setEvents(visible)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load events')
        } finally {
            setLoading(false)
        }
    }, [api])

    useEffect(() => {
        if (open) {
            void refresh()
        }
    }, [open, refresh])

    return (
        <div className="border-t border-[var(--app-divider)]">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                aria-expanded={open}
            >
                <span className="text-[var(--app-fg)]">Overseer events (debug)</span>
                <span className="text-xs text-[var(--app-hint)]">{total} rows</span>
            </button>
            {open && (
                <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)]/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-[var(--app-hint)]">
                            Read-only substrate feed (#22). Populated from AGENT_NOTIFY_SUMMARY + hub fallback.
                        </p>
                        <button
                            type="button"
                            onClick={() => void refresh()}
                            disabled={loading}
                            className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-bg)] disabled:opacity-50"
                        >
                            {loading ? 'Loading…' : 'Refresh'}
                        </button>
                    </div>
                    {error ? (
                        <p className="text-xs text-red-500">{error}</p>
                    ) : null}
                    <div className="max-h-72 overflow-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
                        {events.length === 0 ? (
                            <p className="p-3 text-xs text-[var(--app-hint)]">No events yet.</p>
                        ) : (
                            <ul className="divide-y divide-[var(--app-divider)]">
                                {events.map((event) => {
                                    const relative = formatRelativeTime(event.ts, t) ?? ''
                                    const absolute = formatAbsoluteDateTime(event.ts) ?? undefined
                                    return (
                                        <li key={event.id} className="px-2 py-2 text-[11px] leading-snug">
                                            <div className="flex flex-wrap items-center gap-1">
                                                <span className="font-mono text-[var(--app-hint)]">#{event.id}</span>
                                                <span className="rounded bg-[var(--app-subtle-bg)] px-1 py-0.5 font-medium uppercase tracking-wide text-[var(--app-fg)]">
                                                    {event.eventType}
                                                </span>
                                                {event.attentionCandidate ? (
                                                    <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-700 dark:text-amber-300">
                                                        attention
                                                    </span>
                                                ) : null}
                                                <span className="text-[var(--app-hint)]" title={absolute}>
                                                    {relative}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-[var(--app-fg)]">{event.summary}</p>
                                            <p className="mt-0.5 text-[var(--app-hint)]">
                                                {event.sourceKind}
                                                {event.sourceRef ? ` · ${event.sourceRef}` : ''}
                                                {event.relatedSessionId ? ` · session ${event.relatedSessionId.slice(0, 8)}…` : ''}
                                                {event.provenance ? ` · ${event.provenance}` : ''}
                                            </p>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
