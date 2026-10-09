import { useMemo, useState } from 'react'
import type { TodoBoardItem, TodoBoardSummary } from '@/types/api'
import { TodoBoardSwitcherBar, TodoBoardSwitcherMenu } from '@/components/TodoBoardSwitcher'
import { LoadingState } from '@/components/LoadingState'
import { ExternalLinkIcon, PlusCircleIcon } from '@/components/icons'
import { chipBaseClass, chipIdleClass } from '@/components/filterChipStyles'
import { formatRelativeTime } from '@/lib/relativeTime'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

type StatusGroup = {
    status: string
    items: TodoBoardItem[]
    isDone: boolean
}

// Index-based, not semantic — status names are read verbatim from whatever
// board is configured (hapi#235 design doc), so we can't assume "In
// Progress"/"Todo" wording to pick a meaningful color. Cycling a fixed
// palette by group position gives each status a stable, distinct accent
// without hardcoding assumptions about any particular board's vocabulary.
const STATUS_DOT_PALETTE = ['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500', 'bg-rose-500']

function statusDotClass(colorIndex: number): string {
    return STATUS_DOT_PALETTE[colorIndex % STATUS_DOT_PALETTE.length]
}

// Groups by the board's own status field (verbatim), in board-defined column
// order, with any "no status" items last among the open groups. Done-value
// groups are pulled out into a single collapsed/folded section at the bottom
// regardless of where "Done" sits in the column order (hapi#235 design doc:
// "Grouping inside To-Do mode: board status, not repo").
export function groupItemsByStatus(items: TodoBoardItem[], statusOrder: string[], doneValues: string[]): {
    openGroups: StatusGroup[]
    doneItems: TodoBoardItem[]
} {
    const doneSet = new Set(doneValues)
    const byStatus = new Map<string, TodoBoardItem[]>()
    const noStatus: TodoBoardItem[] = []
    const doneItems: TodoBoardItem[] = []

    for (const item of items) {
        if (item.status && doneSet.has(item.status)) {
            doneItems.push(item)
            continue
        }
        if (!item.status) {
            noStatus.push(item)
            continue
        }
        const existing = byStatus.get(item.status)
        if (existing) {
            existing.push(item)
        } else {
            byStatus.set(item.status, [item])
        }
    }

    const orderedStatuses = statusOrder.filter(status => !doneSet.has(status) && byStatus.has(status))
    for (const status of byStatus.keys()) {
        if (!orderedStatuses.includes(status)) {
            orderedStatuses.push(status)
        }
    }

    const openGroups: StatusGroup[] = orderedStatuses.map(status => ({
        status,
        items: byStatus.get(status) ?? [],
        isDone: false
    }))
    if (noStatus.length > 0) {
        openGroups.push({ status: 'noStatus', items: noStatus, isDone: false })
    }

    return { openGroups, doneItems }
}

// Card, not a text row — operator feedback (hapi#235): the to-do list needs
// "some shape, some structure in time," comparable to GitHub's own board
// cards. The whole card is a GitHub-bound link (via a stretched overlay
// anchor, not by nesting the actions row's buttons inside an <a> — that
// would be invalid HTML and break the disabled spawn button's semantics).
// The actions row needs `relative z-10`: a position:absolute, z-index:auto
// overlay paints *above* non-positioned in-flow content regardless of DOM
// order (CSS2.1 Appendix E, step 6 vs steps 3/5) — without it the overlay
// would swallow clicks meant for the external-link icon and, later, #236's
// spawn button.
function TodoItemCard(props: { item: TodoBoardItem; muted: boolean }) {
    const { t } = useTranslation()
    const { item, muted } = props
    const repoLabel = item.repo ?? t('todo.noRepo')
    const updatedLabel = item.updatedAt ? formatRelativeTime(new Date(item.updatedAt).getTime(), t) : null
    const infoChipClass = cn(chipBaseClass, chipIdleClass, 'pointer-events-none h-6 px-2')

    return (
        <div
            className={cn(
                'relative mb-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 transition-all',
                muted ? 'opacity-60' : 'hover:border-[var(--app-link)]/40 hover:shadow-sm'
            )}
        >
            {item.url ? (
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t('todo.openInGithub')}: ${item.title}`}
                    className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                />
            ) : null}

            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {item.number !== null ? <span className={cn(infoChipClass, 'font-mono')}>#{item.number}</span> : null}
                    <span className={cn(infoChipClass, 'max-w-40 truncate')}>{repoLabel}</span>
                </div>
                <div className="relative z-10 flex shrink-0 items-center gap-1">
                    {item.url ? (
                        <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('todo.openInGithub')}
                            aria-label={`${t('todo.openInGithub')}: ${item.title}`}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        >
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                        </a>
                    ) : null}
                    {/* Reserved, not wired up: hapi#236 (spawn/worktree resolution) slots in here later without reshaping the card. */}
                    <button
                        type="button"
                        disabled
                        title={t('todo.spawnComingSoon')}
                        aria-label={t('todo.spawnComingSoon')}
                        className="flex h-6 w-6 cursor-not-allowed items-center justify-center rounded-full text-[var(--app-hint)] opacity-50"
                    >
                        <PlusCircleIcon className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            <div className={cn('mt-2 line-clamp-2 text-sm', muted ? 'text-[var(--app-hint)]' : 'text-[var(--app-fg)]')}>
                {item.title}
            </div>

            {updatedLabel ? <div className="mt-2 text-xs text-[var(--app-hint)]">{updatedLabel}</div> : null}
        </div>
    )
}

export function TodoBoardList(props: {
    boards: TodoBoardSummary[]
    selectedBoardId: string | null
    onSelectBoard: (id: string) => void
    items: TodoBoardItem[]
    statusOrder: string[]
    doneValues: string[]
    isLoading: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    const [doneExpanded, setDoneExpanded] = useState(false)
    const boardFilterItems = useMemo(
        () => props.boards.map(board => ({ id: board.id, label: board.label })),
        [props.boards]
    )
    const { openGroups, doneItems } = useMemo(
        () => groupItemsByStatus(props.items, props.statusOrder, props.doneValues),
        [props.items, props.statusOrder, props.doneValues]
    )
    // Color index only advances for real statuses — "no status" always gets
    // the same neutral dot rather than consuming a palette slot.
    const groupsWithDot = useMemo(() => {
        let colorIndex = -1
        return openGroups.map((group) => {
            const isNoStatus = group.status === 'noStatus'
            if (!isNoStatus) colorIndex += 1
            return { group, isNoStatus, dotClass: isNoStatus ? 'bg-[var(--app-hint)]' : statusDotClass(colorIndex) }
        })
    }, [openGroups])

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="mx-auto w-full max-w-content shrink-0">
                <div className="flex items-center gap-1 px-2 py-1">
                    <div className="flex-1" />
                    <TodoBoardSwitcherMenu
                        boards={boardFilterItems}
                        value={props.selectedBoardId}
                        onChange={props.onSelectBoard}
                    />
                </div>
                <TodoBoardSwitcherBar
                    boards={boardFilterItems}
                    value={props.selectedBoardId}
                    onChange={props.onSelectBoard}
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {props.isLoading ? (
                    <div className="flex justify-center py-6">
                        <LoadingState label={t('todo.loading')} />
                    </div>
                ) : props.error ? (
                    <div className="px-1 py-4 text-sm text-red-600">
                        {t('todo.error', { message: props.error })}
                    </div>
                ) : props.items.length === 0 ? (
                    <div className="px-1 py-4 text-sm text-[var(--app-hint)]">{t('todo.empty')}</div>
                ) : (
                    <>
                        {groupsWithDot.map(({ group, isNoStatus, dotClass }) => (
                            <div key={group.status} className="mb-3">
                                <div className="flex items-center gap-1.5 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                    <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
                                    {isNoStatus ? t('todo.noStatus') : group.status} ({group.items.length})
                                </div>
                                {group.items.map((item) => (
                                    <TodoItemCard key={item.id} item={item} muted={false} />
                                ))}
                            </div>
                        ))}
                        {doneItems.length > 0 ? (
                            <div className="mt-2 border-t border-[var(--app-border)] pt-2">
                                <button
                                    type="button"
                                    onClick={() => setDoneExpanded(value => !value)}
                                    aria-expanded={doneExpanded}
                                    className="w-full rounded-lg px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                >
                                    {doneExpanded
                                        ? t('todo.doneSection.collapse', { n: doneItems.length })
                                        : t('todo.doneSection.expand', { n: doneItems.length })}
                                </button>
                                {doneExpanded ? doneItems.map((item) => (
                                    <TodoItemCard key={item.id} item={item} muted />
                                )) : null}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    )
}
