import { useCallback, useMemo, useState } from 'react'
import { parseArtifactRefs } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { CloseIcon } from '@/components/icons'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useSessionSystemEvents } from '@/hooks/queries/useSessionSystemEvents'
import { useTranslation } from '@/lib/use-translation'
import type { SystemEventRow } from '@/types/systemEvents'

export type SessionLogFilter = 'all' | 'links'

/** All tab is progress/memory — not the Links carveout, and not ambient silence rows. */
const ALL_TAB_EXCLUDED_EVENT_TYPES = new Set(['link_seen', 'stale'])

function formatEventTime(ts: number): string {
    try {
        return new Date(ts).toLocaleString()
    } catch {
        return String(ts)
    }
}

function primaryUrl(event: SystemEventRow): string | null {
    const refs = parseArtifactRefs(event.artifactRefs)
    const urlRef = refs.find((ref) => ref.kind === 'url' && typeof ref.url === 'string' && ref.url.trim())
    if (urlRef?.url?.trim()) return urlRef.url.trim()
    for (const ref of refs) {
        if (ref.url?.trim()) return ref.url.trim()
    }
    return null
}

function SessionLogEventRow(props: { event: SystemEventRow }) {
    const { t } = useTranslation()
    const url = primaryUrl(props.event)

    return (
        <li className="rounded-md px-2 py-2 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-hint)]">
                    {props.event.eventType}
                </span>
                <span className="text-[11px] text-[var(--app-hint)]">{formatEventTime(props.event.ts)}</span>
            </div>
            <p className="mt-1 text-sm leading-snug text-[var(--app-fg)]">{props.event.summary}</p>
            {url && props.event.eventType === 'link_seen' ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block truncate text-xs text-[var(--app-link)] hover:underline"
                    title={url}
                >
                    {url}
                </a>
            ) : null}
            {props.event.provenance ? (
                <p className="mt-0.5 text-[11px] text-[var(--app-hint)]">
                    {t('session.log.provenance')}: {props.event.provenance}
                </p>
            ) : null}
        </li>
    )
}

export function SessionLogPanel(props: {
    api: ApiClient
    sessionId: string
    title: string
    onClose: () => void
    initialFilter?: SessionLogFilter
}) {
    const { t } = useTranslation()
    const [filter, setFilter] = useState<SessionLogFilter>(props.initialFilter ?? 'all')
    const [older, setOlder] = useState<SystemEventRow[]>([])
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [olderError, setOlderError] = useState<string | null>(null)
    const [reachedEnd, setReachedEnd] = useState(false)

    const eventType = filter === 'links' ? 'link_seen' : null
    const { events: page, isLoading, error, refetch } = useSessionSystemEvents(
        props.api,
        props.sessionId,
        eventType,
        true
    )

    const events = useMemo(() => {
        const merged = older.length === 0
            ? page
            : (() => {
                const seen = new Set(page.map((event) => event.id))
                return [...page, ...older.filter((event) => !seen.has(event.id))]
            })()
        if (filter === 'links') return merged
        return merged.filter((event) => !ALL_TAB_EXCLUDED_EVENT_TYPES.has(event.eventType))
    }, [page, older, filter])

    const handleFilterChange = useCallback((next: SessionLogFilter) => {
        setFilter(next)
        setOlder([])
        setReachedEnd(false)
        setOlderError(null)
    }, [])

    const handleRefresh = useCallback(() => {
        setOlder([])
        setReachedEnd(false)
        setOlderError(null)
        void refetch()
    }, [refetch])

    const handleLoadOlder = useCallback(async () => {
        if (loadingOlder || reachedEnd || events.length === 0) return
        const beforeId = events[events.length - 1]?.id
        if (beforeId === undefined) return
        setLoadingOlder(true)
        setOlderError(null)
        try {
            const data = await props.api.fetchSystemEvents({
                sessionId: props.sessionId,
                limit: 100,
                beforeId,
                eventType: eventType ?? undefined
            }) as { events: SystemEventRow[] }
            if (data.events.length === 0) {
                setReachedEnd(true)
            } else {
                setOlder((prev) => [...prev, ...data.events])
            }
        } catch (err) {
            setOlderError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoadingOlder(false)
        }
    }, [events, eventType, loadingOlder, props.api, props.sessionId, reachedEnd])

    return (
        <aside
            className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[24rem] flex-col border-l border-[var(--app-border)] bg-[var(--app-bg)] shadow-2xl sm:w-[24rem]"
            aria-label={t('session.log.title')}
        >
            <div className="flex items-start gap-3 border-b border-[var(--app-border)] p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{t('session.log.title')}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{props.title}</div>
                </div>
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('session.log.refresh')}
                    title={t('session.log.refresh')}
                >
                    {isLoading ? <Spinner size="sm" label={null} className="text-current" /> : (
                        <span aria-hidden="true" className="text-sm">↻</span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={props.onClose}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('button.close')}
                    title={t('button.close')}
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>

            <div className="flex gap-1 border-b border-[var(--app-border)] p-2" role="tablist" aria-label={t('session.log.filters')}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'all'}
                    onClick={() => handleFilterChange('all')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        filter === 'all'
                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    }`}
                >
                    {t('session.log.filter.all')}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'links'}
                    onClick={() => handleFilterChange('links')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        filter === 'links'
                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    }`}
                >
                    {t('session.log.filter.links')}
                </button>
            </div>

            <div className="app-scroll-y min-h-0 flex-1 p-2">
                {error || olderError ? (
                    <div className="px-2 py-4 text-center text-sm text-red-500">
                        {error ?? olderError}
                    </div>
                ) : null}
                {isLoading && events.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 px-2 py-8 text-sm text-[var(--app-hint)]">
                        <Spinner size="sm" label={null} className="text-current" />
                        {t('misc.loading')}
                    </div>
                ) : events.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-[var(--app-hint)]">
                        {filter === 'links' ? t('session.log.emptyLinks') : t('session.log.empty')}
                    </div>
                ) : (
                    <ul className="space-y-1">
                        {events.map((event) => (
                            <SessionLogEventRow key={event.id} event={event} />
                        ))}
                    </ul>
                )}
            </div>

            {!reachedEnd && events.length > 0 ? (
                <div className="border-t border-[var(--app-border)] p-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            void handleLoadOlder()
                        }}
                        disabled={loadingOlder}
                        aria-busy={loadingOlder}
                        className="w-full gap-1.5 text-xs"
                    >
                        {loadingOlder ? (
                            <>
                                <Spinner size="sm" label={null} className="text-current" />
                                {t('misc.loading')}
                            </>
                        ) : (
                            <>
                                <span aria-hidden="true">↑</span>
                                {t('session.log.loadOlder')}
                            </>
                        )}
                    </Button>
                </div>
            ) : null}
        </aside>
    )
}
