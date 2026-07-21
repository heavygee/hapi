import { useMemo } from 'react'
import type { ChatBlock } from '@/chat/types'
import type { SessionMetadataSummary } from '@/types/api'
import { collectFileAttention } from '@/chat/fileAttention'
import { buildTraceGraph, selectTraceNodesForDisplay, type TraceNode } from '@/chat/traceGraph'
import { resolveDisplayPath } from '@/utils/path'
import { useTranslation } from '@/lib/use-translation'

/**
 * Read-only "flow" view of a session's execution, derived from the ChatBlock
 * tree. Cursor ACP sessions usually lack file paths on Read File / Edit File
 * tool-calls — so we lead with activity-by-kind counts, show a path heatmap
 * when paths exist, and collapse consecutive same-kind steps in the flow list.
 *
 * Cursor subagents (`CursorTask`) are labeled by title; their nested tool
 * stream is usually absent from the parent session.
 */

function stateDotClass(state: TraceNode['state']): string {
    switch (state) {
        case 'error':
            return 'bg-red-500'
        case 'running':
            return 'bg-amber-500'
        case 'pending':
            return 'bg-[var(--app-hint)]'
        default:
            return 'bg-emerald-500'
    }
}

function activityLine(
    activity: { reads: number; writes: number; deletes: number; total: number },
    t: (key: string, params?: Record<string, string | number>) => string,
): string {
    const parts: string[] = []
    if (activity.reads > 0) parts.push(t('session.flow.activityReads', { n: activity.reads }))
    if (activity.writes > 0) parts.push(t('session.flow.activityWrites', { n: activity.writes }))
    if (activity.deletes > 0) parts.push(t('session.flow.activityDeletes', { n: activity.deletes }))
    if (parts.length === 0) return t('session.flow.filesEmpty')
    return parts.join(' · ')
}

export function SessionFlowPanel(props: {
    blocks: ChatBlock[]
    metadata: SessionMetadataSummary | null
}) {
    const { t } = useTranslation()
    const attention = useMemo(() => collectFileAttention(props.blocks), [props.blocks])
    const graph = useMemo(() => buildTraceGraph(props.blocks), [props.blocks])
    const display = useMemo(() => selectTraceNodesForDisplay(graph.nodes), [graph.nodes])
    const subagentCount = useMemo(
        () => graph.nodes.filter((n) => n.kind === 'subagent').length,
        [graph.nodes],
    )

    const { touches, activity } = attention
    const maxTotal = touches.length > 0 ? touches[0].total : 0
    const hasPathlessFileActivity = activity.pathless > 0 && touches.length === 0
    const hasMixedPathless = activity.pathless > 0 && touches.length > 0

    return (
        <div className="mx-auto w-full max-w-content px-3 pb-3">
            <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3">
                {/* Activity summary — always useful on Cursor sessions */}
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.flow.activity')}
                </div>
                <div className="mb-4 text-sm">
                    {activity.total > 0 || subagentCount > 0 ? (
                        <span>
                            {activity.total > 0 ? activityLine(activity, t) : null}
                            {activity.total > 0 && subagentCount > 0 ? ' · ' : null}
                            {subagentCount > 0
                                ? t('session.flow.activitySubagents', { n: subagentCount })
                                : null}
                        </span>
                    ) : (
                        <span className="text-[var(--app-hint)]">{t('session.flow.filesEmpty')}</span>
                    )}
                </div>

                {/* Files touched (path heatmap when available) */}
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.flow.files')}
                </div>
                {touches.length === 0 ? (
                    <div className="text-sm text-[var(--app-hint)]">
                        {hasPathlessFileActivity
                            ? t('session.flow.filesPathless', { n: activity.pathless })
                            : t('session.flow.filesEmpty')}
                    </div>
                ) : (
                    <>
                        {hasMixedPathless ? (
                            <div className="mb-2 text-xs text-[var(--app-hint)]">
                                {t('session.flow.filesPathlessPartial', { n: activity.pathless })}
                            </div>
                        ) : null}
                        <ul className="flex flex-col gap-1">
                            {touches.map((touch) => {
                                const displayPath = resolveDisplayPath(touch.path, props.metadata)
                                const pct = maxTotal > 0 ? Math.round((touch.total / maxTotal) * 100) : 0
                                return (
                                    <li key={touch.path} className="flex items-center gap-2 text-sm">
                                        <div className="relative min-w-0 flex-1 overflow-hidden rounded bg-[var(--app-bg)]">
                                            <div
                                                className="absolute inset-y-0 left-0 bg-[var(--app-secondary-bg)]"
                                                style={{ width: `${pct}%` }}
                                                aria-hidden="true"
                                            />
                                            <span className="relative block truncate px-2 py-1 font-mono text-xs" title={touch.path}>
                                                {displayPath}
                                            </span>
                                        </div>
                                        <span className="shrink-0 font-mono text-xs text-[var(--app-hint)]">
                                            {touch.writes > 0 ? (
                                                <span className="text-amber-600">
                                                    {t('session.flow.writes', { n: touch.writes })}
                                                </span>
                                            ) : null}
                                            {touch.writes > 0 && touch.reads > 0 ? ' · ' : ''}
                                            {touch.reads > 0 ? t('session.flow.reads', { n: touch.reads }) : ''}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </>
                )}

                {/* Execution flow */}
                <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.flow.graph')}
                </div>
                {graph.nodes.length === 0 ? (
                    <div className="text-sm text-[var(--app-hint)]">{t('session.flow.graphEmpty')}</div>
                ) : (
                    <>
                        {display.hiddenCount > 0 ? (
                            <div className="mb-2 text-xs text-[var(--app-hint)]">
                                {t('session.flow.graphTruncated', { n: display.hiddenCount })}
                            </div>
                        ) : null}
                        <ul className="flex flex-col gap-0.5">
                            {display.visible.map((node) => (
                                <li
                                    key={node.id}
                                    className="flex items-center gap-2 text-sm"
                                    style={{ paddingLeft: `${node.depth * 16}px` }}
                                >
                                    {node.depth > 0 ? (
                                        <span className="select-none text-[var(--app-hint)]" aria-hidden="true">
                                            └
                                        </span>
                                    ) : null}
                                    <span
                                        className={`h-2 w-2 shrink-0 rounded-full ${stateDotClass(node.state)}`}
                                        aria-hidden="true"
                                    />
                                    <span
                                        className={
                                            node.kind === 'subagent'
                                                ? 'min-w-0 truncate text-xs font-semibold'
                                                : 'text-xs font-medium'
                                        }
                                        title={node.kind === 'subagent' ? node.label : undefined}
                                    >
                                        {node.label}
                                        {node.count > 1 ? (
                                            <span className="text-[var(--app-hint)]"> ×{node.count}</span>
                                        ) : null}
                                    </span>
                                    {node.detail ? (
                                        <span className="min-w-0 truncate font-mono text-xs text-[var(--app-hint)]" title={node.detail}>
                                            {node.detail}
                                        </span>
                                    ) : null}
                                    {node.kind === 'subagent' && node.childCount > 0 ? (
                                        <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                            {t('session.flow.subagentSteps', { n: node.childCount })}
                                        </span>
                                    ) : null}
                                    {node.kind === 'subagent' && node.childCount === 0 ? (
                                        <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                            {t('session.flow.subagentOpaque')}
                                        </span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </div>
    )
}
