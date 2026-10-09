import { useMemo, useState } from 'react'
import type { TodoBoardItem, TodoBoardSummary } from '@/types/api'
import { TodoBoardSwitcherBar, TodoBoardSwitcherMenu } from '@/components/TodoBoardSwitcher'
import { LoadingState } from '@/components/LoadingState'
import { ExternalLinkIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

type StatusGroup = {
    status: string
    items: TodoBoardItem[]
    isDone: boolean
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

function TodoItemRow(props: { item: TodoBoardItem; muted: boolean }) {
    const { t } = useTranslation()
    const { item, muted } = props
    const label = item.repo
        ? `${item.repo}${item.number !== null ? `#${item.number}` : ''}`
        : t('todo.noRepo')

    const content = (
        <>
            <span className={cn('min-w-0 flex-1 truncate text-sm', muted ? 'text-[var(--app-hint)]' : 'text-[var(--app-fg)]')}>
                {item.title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--app-hint)]">{label}</span>
            {item.url ? <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)]" /> : null}
        </>
    )

    if (!item.url) {
        return (
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                {content}
            </div>
        )
    }

    return (
        <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t('todo.openInGithub')}
            aria-label={`${t('todo.openInGithub')}: ${item.title}`}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            {content}
        </a>
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
                        {openGroups.map((group) => (
                            <div key={group.status} className="mb-3">
                                <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                    {group.status === 'noStatus' ? t('todo.noStatus') : group.status} ({group.items.length})
                                </div>
                                {group.items.map((item) => (
                                    <TodoItemRow key={item.id} item={item} muted={false} />
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
                                    <TodoItemRow key={item.id} item={item} muted />
                                )) : null}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    )
}
