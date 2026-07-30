import { useMemo } from 'react'
import type { ChatBlock } from '@/chat/types'
import type { SessionMetadataSummary } from '@/types/api'
import { collectFileAttention } from '@/chat/fileAttention'
import { buildTraceGraph, selectTraceNodesForDisplay } from '@/chat/traceGraph'
import { SessionFlowGraph } from '@/components/SessionFlowGraph'
import { resolveDisplayPath } from '@/utils/path'
import { useTranslation } from '@/lib/use-translation'

/**
 * Session "flow" dogfood surface: file-attention summary + interactive SVG
 * execution graph (pan / zoom / select). The list view was not useful;
 * this is the Agent Flow–inspired visual we needed to falsify.
 */

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

                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.flow.files')}
                </div>
                {touches.length === 0 ? (
                    <div className="mb-4 text-sm text-[var(--app-hint)]">
                        {hasPathlessFileActivity
                            ? t('session.flow.filesPathless', { n: activity.pathless })
                            : t('session.flow.filesEmpty')}
                    </div>
                ) : (
                    <div className="mb-4">
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
                    </div>
                )}

                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.flow.graph')}
                </div>
                {display.hiddenCount > 0 ? (
                    <div className="mb-2 text-xs text-[var(--app-hint)]">
                        {t('session.flow.graphTruncated', { n: display.hiddenCount })}
                    </div>
                ) : null}
                <SessionFlowGraph graph={graph} nodes={display.visible} />
            </div>
        </div>
    )
}
