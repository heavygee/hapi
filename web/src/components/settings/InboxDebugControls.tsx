import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import type { InboxOperatorAction } from '@hapi/protocol'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/relative-time'
import { useTranslation } from '@/lib/use-translation'

export type InboxItemRow = {
    id: number
    status: string
    priority: number
    basePriority: number
    title: string
    category: string
    summary: string
    suggestedAction: string | null
    reasonForPriority: string | null
    sourceEventIds: number[]
    relatedSessionId: string | null
    createdAt: number
    updatedAt: number
}

type InboxItemsResponse = {
    total: number
    items: InboxItemRow[]
}

export function InboxDebugControls() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [total, setTotal] = useState(0)
    const [items, setItems] = useState<InboxItemRow[]>([])

    const refresh = useCallback(async () => {
        if (!api) {
            setError('Not authenticated')
            return
        }
        setLoading(true)
        setError(null)
        try {
            const data = await api.fetchInboxItems({ limit: 80, activeOnly: true }) as InboxItemsResponse
            setTotal(data.total)
            setItems(data.items)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load inbox items')
        } finally {
            setLoading(false)
        }
    }, [api])

    const runAction = useCallback(async (itemId: number, action: InboxOperatorAction) => {
        if (!api) return
        setLoading(true)
        setError(null)
        try {
            await api.recordInboxOperatorAction(itemId, action)
            await refresh()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Action failed')
        } finally {
            setLoading(false)
        }
    }, [api, refresh])

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
                <span className="text-[var(--app-fg)]">Attention inbox (debug)</span>
                <span className="text-xs text-[var(--app-hint)]">{total} items</span>
            </button>
            {open && (
                <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)]/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-[var(--app-hint)]">
                            Per-session promotion (#23). Coarse rank, oldest within tier. Actions log training labels.
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
                        {items.length === 0 ? (
                            <p className="p-3 text-xs text-[var(--app-hint)]">No inbox items yet.</p>
                        ) : (
                            <ul className="divide-y divide-[var(--app-divider)]">
                                {items.map((item) => {
                                    const relative = formatRelativeTime(item.createdAt, t) ?? ''
                                    const absolute = formatAbsoluteDateTime(item.createdAt) ?? undefined
                                    return (
                                        <li key={item.id} className="px-2 py-2 text-[11px] leading-snug">
                                            <div className="flex flex-wrap items-center gap-1">
                                                <span className="font-mono text-[var(--app-hint)]">#{item.id}</span>
                                                <span className="rounded bg-[var(--app-subtle-bg)] px-1 py-0.5 font-medium uppercase tracking-wide text-[var(--app-fg)]">
                                                    {item.category}
                                                </span>
                                                <span className="text-[var(--app-hint)]" title={absolute}>
                                                    {relative}
                                                </span>
                                            </div>
                                            <p className="mt-1 font-medium text-[var(--app-fg)]">{item.title}</p>
                                            <p className="mt-0.5 text-[var(--app-fg)]">{item.summary}</p>
                                            {item.reasonForPriority ? (
                                                <p className="mt-0.5 text-[var(--app-hint)]">{item.reasonForPriority}</p>
                                            ) : null}
                                            {item.suggestedAction ? (
                                                <p className="mt-0.5 text-[var(--app-hint)]">Next: {item.suggestedAction}</p>
                                            ) : null}
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {(['open', 'snooze', 'done', 'dismiss'] as const).map((action) => (
                                                    <button
                                                        key={action}
                                                        type="button"
                                                        disabled={loading}
                                                        onClick={() => void runAction(item.id, action)}
                                                        className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                                    >
                                                        {action}
                                                    </button>
                                                ))}
                                            </div>
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
