import { useState } from 'react'
import type { TodoBoardItem } from '@/types/api'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExternalLinkIcon, PlusCircleIcon, RefreshIcon } from '@/components/icons'
import { chipBaseClass, chipIdleClass } from '@/components/filterChipStyles'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/relativeTime'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

function BackIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
        </svg>
    )
}

function toEpochMs(iso: string | null): number | null {
    if (!iso) return null
    const ms = new Date(iso).getTime()
    return Number.isFinite(ms) ? ms : null
}

function TimestampRow(props: { label: string; iso: string | null; t: (key: string, params?: Record<string, string | number>) => string }) {
    const ms = toEpochMs(props.iso)
    if (ms === null) return null
    const relative = formatRelativeTime(ms, props.t)
    return (
        <div className="flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
            <span>{props.label}:</span>
            <span title={formatAbsoluteDateTime(ms) ?? undefined}>{relative}</span>
        </div>
    )
}

// Right-pane detail for a to-do card click (hapi#235) — same slot session
// detail occupies today. "Spawn session" reuses the existing new-session
// flow entirely (NewSession's initialDirectory/initialMachineId/
// initialMessage props) — resolving a directory and building the briefing
// message both happen in the parent (router.tsx), this component just
// triggers it. The parent also passes the item's issue URL through so the
// new session is auto-linked (metadata.externalRefs) once created, surfacing
// as an IssueRefChip on the resulting session row/detail.
//
// Write actions (close/reopen/comment/status) all require item.url — draft
// issues (no linked Issue/PR) have nothing for `gh issue`/`gh project
// item-edit` to target, so the whole write-actions section is gated on it
// (operator decision, hapi#238: "the whole reason to bring these cards here
// is to not have to go to GitHub" — but that's only possible for items that
// actually link to something on GitHub).
export function TodoItemDetail(props: {
    item: TodoBoardItem
    statusOrder: string[]
    onBack: () => void
    onSpawn: () => void
    onRefresh: () => void
    isRefreshing: boolean
    onClose: () => Promise<void>
    onReopen: () => void
    onComment: (body: string) => Promise<void>
    onSetStatus: (status: string) => void
    isClosing: boolean
    isReopening: boolean
    isCommenting: boolean
    isSettingStatus: boolean
}) {
    const { t } = useTranslation()
    const { item } = props
    const repoLabel = item.repo ?? t('todo.noRepo')
    const updatedLabel = item.updatedAt ? formatRelativeTime(new Date(item.updatedAt).getTime(), t) : null
    const chipClass = cn(chipBaseClass, chipIdleClass, 'pointer-events-none h-6 px-2')
    const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
    const [commentDraft, setCommentDraft] = useState('')
    const canWrite = item.url !== null
    const isClosed = item.state === 'CLOSED' || item.state === 'MERGED'

    const handleSendComment = async () => {
        const body = commentDraft.trim()
        if (!body) return
        try {
            await props.onComment(body)
            setCommentDraft('')
        } catch {
            // Failure is already surfaced as a toast by the caller — keep the
            // draft intact so the user's typed comment isn't lost.
        }
    }

    return (
        <div data-testid="todo-item-detail" className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            <div className="flex shrink-0 items-start gap-2 border-b border-[var(--app-border)] p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
                <button
                    type="button"
                    onClick={props.onBack}
                    aria-label={t('todo.detail.back')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] split:hidden"
                >
                    <BackIcon />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {item.status ? <span className={chipClass}>{item.status}</span> : null}
                        {item.number !== null ? <span className={cn(chipClass, 'font-mono')}>#{item.number}</span> : null}
                        <span className={cn(chipClass, 'max-w-48 truncate')}>{repoLabel}</span>
                        {updatedLabel ? <span className="text-xs text-[var(--app-hint)]">{updatedLabel}</span> : null}
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-[var(--app-fg)]">{item.title}</h2>
                </div>
                <button
                    type="button"
                    onClick={props.onRefresh}
                    disabled={props.isRefreshing}
                    aria-label={t('todo.detail.refresh')}
                    title={t('todo.detail.refresh')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                >
                    <RefreshIcon className={cn('h-4 w-4', props.isRefreshing && 'animate-spin')} />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-2 border-b border-[var(--app-border)] pb-4">
                    {item.author ? (
                        <div className="flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
                            <img src={item.author.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                            <span>{t('todo.detail.openedBy', { login: item.author.login })}</span>
                        </div>
                    ) : null}
                    {item.assignees.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--app-hint)]">
                            <span>{t('todo.detail.assignees')}:</span>
                            {item.assignees.map(assignee => (
                                <span key={assignee.login} className="inline-flex items-center gap-1">
                                    <img src={assignee.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                                    {assignee.login}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {item.labels.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {item.labels.map(label => (
                                <span
                                    key={label.name}
                                    className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]"
                                >
                                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} />
                                    {label.name}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {item.milestone ? (
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('todo.detail.milestone')}: {item.milestone.title}
                            {item.milestone.dueOn ? ` (${t('todo.detail.dueOn', { date: item.milestone.dueOn })})` : ''}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <TimestampRow label={t('todo.detail.created')} iso={item.createdAt} t={t} />
                        <TimestampRow label={t('todo.detail.updated')} iso={item.updatedAt} t={t} />
                        <TimestampRow label={t('todo.detail.closed')} iso={item.closedAt} t={t} />
                    </div>

                    {canWrite ? (
                        <label className="mt-1 flex items-center gap-2 text-xs text-[var(--app-hint)]">
                            {t('todo.detail.status')}:
                            <select
                                value={item.status ?? ''}
                                disabled={props.isSettingStatus}
                                onChange={(event) => {
                                    const next = event.target.value
                                    if (next && next !== item.status) {
                                        props.onSetStatus(next)
                                    }
                                }}
                                className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-xs text-[var(--app-fg)]"
                            >
                                {item.status === null ? <option value="">{t('todo.noStatus')}</option> : null}
                                {props.statusOrder.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                </div>

                <div className="pt-4">
                    {item.body ? (
                        <MarkdownRenderer standalone content={item.body} />
                    ) : (
                        <p className="text-sm text-[var(--app-hint)]">{t('todo.detail.noBody')}</p>
                    )}
                </div>

                {item.customFields.length > 0 ? (
                    <div className="mt-4 border-t border-[var(--app-border)] pt-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">{t('todo.detail.customFields')}</div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                            {item.customFields.map(field => (
                                <div key={field.name} className="contents">
                                    <dt className="text-[var(--app-hint)]">{field.name}</dt>
                                    <dd className="text-[var(--app-fg)]">{field.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ) : null}

                {canWrite ? (
                    <div className="mt-4 border-t border-[var(--app-border)] pt-4">
                        <label htmlFor="todo-item-comment" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                            {t('todo.detail.comment')}
                        </label>
                        <textarea
                            id="todo-item-comment"
                            value={commentDraft}
                            onChange={(event) => setCommentDraft(event.target.value)}
                            disabled={props.isCommenting}
                            placeholder={t('todo.detail.commentPlaceholder')}
                            rows={3}
                            className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        />
                        <div className="mt-1.5 flex justify-end">
                            <Button type="button" variant="outline" disabled={props.isCommenting || !commentDraft.trim()} onClick={handleSendComment}>
                                {props.isCommenting ? t('todo.detail.commenting') : t('todo.detail.sendComment')}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--app-border)] p-3">
                {item.url ? (
                    <Button asChild variant="outline">
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLinkIcon className="h-4 w-4" />
                            {t('todo.detail.openInGithub')}
                        </a>
                    </Button>
                ) : null}
                <Button
                    type="button"
                    variant="outline"
                    onClick={props.onSpawn}
                >
                    <PlusCircleIcon className="h-4 w-4" />
                    {t('todo.detail.spawnSession')}
                </Button>
                {/* A merged PR can't be reopened via `gh pr reopen` (GitHub rejects it) and is
                    already terminally closed, so neither action applies — unlike a plain closed
                    issue/PR, which `gh ... reopen` handles fine. */}
                {canWrite && item.state !== 'MERGED' ? (
                    isClosed ? (
                        <Button type="button" variant="outline" disabled={props.isReopening} onClick={props.onReopen}>
                            {props.isReopening ? t('todo.detail.reopening') : t('todo.detail.reopen')}
                        </Button>
                    ) : (
                        <Button type="button" variant="outline" disabled={props.isClosing} onClick={() => setCloseConfirmOpen(true)}>
                            {props.isClosing ? t('todo.detail.closing') : t('todo.detail.close')}
                        </Button>
                    )
                ) : null}
            </div>

            <ConfirmDialog
                isOpen={closeConfirmOpen}
                onClose={() => setCloseConfirmOpen(false)}
                title={t('todo.detail.closeConfirmTitle')}
                description={t('todo.detail.closeConfirmDescription', { title: item.title })}
                confirmLabel={t('todo.detail.close')}
                confirmingLabel={t('todo.detail.closing')}
                onConfirm={async () => {
                    try {
                        await props.onClose()
                    } catch (err) {
                        throw new Error(getApiErrorMessage(err, t('dialog.error.default')))
                    }
                }}
                isPending={props.isClosing}
                destructive
            />
        </div>
    )
}
