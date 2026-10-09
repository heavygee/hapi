import type { TodoBoardItem } from '@/types/api'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { ExternalLinkIcon, PlusCircleIcon } from '@/components/icons'
import { chipBaseClass, chipIdleClass } from '@/components/filterChipStyles'
import { formatRelativeTime } from '@/lib/relativeTime'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

function BackIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
        </svg>
    )
}

// Right-pane detail for a to-do card click (hapi#235) — same slot session
// detail occupies today. "Spawn session" reuses the existing new-session
// flow entirely (NewSession's initialDirectory/initialMachineId/
// initialMessage props) — resolving a directory and building the briefing
// message both happen in the parent (router.tsx), this component just
// triggers it. Not the formal externalRefs/github_issue chip mechanism
// (#233, blocked on driver/-only PR-chip infra) — the spawned session is
// only briefed via its first composer message, no structured persisted link.
export function TodoItemDetail(props: {
    item: TodoBoardItem
    onBack: () => void
    onSpawn: () => void
}) {
    const { t } = useTranslation()
    const { item } = props
    const repoLabel = item.repo ?? t('todo.noRepo')
    const updatedLabel = item.updatedAt ? formatRelativeTime(new Date(item.updatedAt).getTime(), t) : null
    const chipClass = cn(chipBaseClass, chipIdleClass, 'pointer-events-none h-6 px-2')

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
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
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {item.body ? (
                    <MarkdownRenderer standalone content={item.body} />
                ) : (
                    <p className="text-sm text-[var(--app-hint)]">{t('todo.detail.noBody')}</p>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--app-border)] p-3">
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
            </div>
        </div>
    )
}
