import { useCallback, useMemo, useState } from 'react'
import { parseArtifactRefs } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { CloseIcon } from '@/components/icons'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useSessionSystemEvents } from '@/hooks/queries/useSessionSystemEvents'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/relative-time'
import { useTranslation } from '@/lib/use-translation'
import type { SystemEventRow } from '@/types/systemEvents'

export type SessionLogFilter = 'all' | 'links'

/** All tab is progress/memory — not the Links carveout, and not ambient silence rows. */
const ALL_TAB_EXCLUDED_EVENT_TYPES = new Set(['link_seen', 'stale'])

function primaryUrl(event: SystemEventRow): string | null {
    const refs = parseArtifactRefs(event.artifactRefs)
    const urlRef = refs.find((ref) => ref.kind === 'url' && typeof ref.url === 'string' && ref.url.trim())
    if (urlRef?.url?.trim()) return urlRef.url.trim()
    for (const ref of refs) {
        if (ref.url?.trim()) return ref.url.trim()
    }
    return null
}

/** Compact display for a URL — host + path, no scheme, truncated. */
export function compactUrlLabel(url: string, maxLen = 64): string {
    try {
        const parsed = new URL(url)
        const path = parsed.pathname === '/' ? '' : parsed.pathname
        const label = `${parsed.host}${path}${parsed.search}`
        return label.length > maxLen ? `${label.slice(0, maxLen - 1)}…` : label
    } catch {
        return url.length > maxLen ? `${url.slice(0, maxLen - 1)}…` : url
    }
}

/** Hub event payload embeds the originating transcript message id when known. */
export function parseSessionLogMessageId(payloadJson: string | null): string | null {
    if (!payloadJson) return null
    try {
        const parsed: unknown = JSON.parse(payloadJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const messageId = (parsed as { messageId?: unknown }).messageId
        if (typeof messageId !== 'string') return null
        const trimmed = messageId.trim()
        return trimmed.length > 0 ? trimmed : null
    } catch {
        return null
    }
}

/**
 * DOM anchors are `hapi-message-${kind}:${blockId}` (see outline.ts).
 * Hub stores the bare message UUID; chat blocks use `${uuid}:${idx}` for agent text.
 */
export function sessionLogTargetMessageIds(hubMessageId: string): string[] {
    return [
        `agent-text:${hubMessageId}:0`,
        `agent-text:${hubMessageId}`,
        `agent-text:${hubMessageId}:1`,
        `user-text:${hubMessageId}`,
        `cli-output:${hubMessageId}:0`,
    ]
}

function SessionLogEventRow(props: {
    event: SystemEventRow
    filter: SessionLogFilter
    onSelectMessage?: (messageId: string) => void
}) {
    const { t } = useTranslation()
    const url = primaryUrl(props.event)
    const isLink = props.event.eventType === 'link_seen' && url
    const relative = formatRelativeTime(props.event.ts, t) ?? ''
    const absolute = formatAbsoluteDateTime(props.event.ts) ?? undefined
    const messageId = parseSessionLogMessageId(props.event.payloadJson)
    const jumpable = Boolean(messageId && props.onSelectMessage)

    const meta = (
        <div className="flex min-w-0 items-baseline gap-2">
            {props.filter === 'all' ? (
                <span className="shrink-0 rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-hint)]">
                    {props.event.eventType}
                </span>
            ) : null}
            <span
                className="ml-auto shrink-0 text-[11px] text-[var(--app-hint)]"
                title={absolute}
            >
                {relative}
            </span>
        </div>
    )

    const body = isLink ? (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-sm leading-snug text-[var(--app-link)] hover:underline"
            title={url}
            onClick={(event) => {
                // Keep external open; do not also jump the chat.
                event.stopPropagation()
            }}
        >
            {compactUrlLabel(url)}
        </a>
    ) : (
        <p className="mt-0.5 text-sm leading-snug text-[var(--app-fg)]">{props.event.summary}</p>
    )

    if (jumpable && messageId) {
        const label = isLink && url ? compactUrlLabel(url) : props.event.summary
        return (
            <li className="rounded-md text-left">
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                    onClick={() => props.onSelectMessage?.(messageId)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            props.onSelectMessage?.(messageId)
                        }
                    }}
                >
                    {meta}
                    {body}
                </div>
            </li>
        )
    }

    return (
        <li className="rounded-md px-2 py-1.5 text-left">
            {meta}
            {body}
        </li>
    )
}

export function SessionLogPanel(props: {
    api: ApiClient
    sessionId: string
    title: string
    onClose: () => void
    initialFilter?: SessionLogFilter
    onSelectMessage?: (messageId: string) => void
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
                    <ul className="space-y-0.5">
                        {events.map((event) => (
                            <SessionLogEventRow
                                key={event.id}
                                event={event}
                                filter={filter}
                                onSelectMessage={props.onSelectMessage}
                            />
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
