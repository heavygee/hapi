import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { TraceGraph, TraceNode } from '@/chat/traceGraph'
import { edgePath, layoutTraceGraph, type LaidOutNode } from '@/chat/traceGraphLayout'
import { useTranslation } from '@/lib/use-translation'

type ViewTransform = { x: number; y: number; k: number }

function stateFill(state: TraceNode['state']): string {
    switch (state) {
        case 'error':
            return 'var(--app-danger, #ef4444)'
        case 'running':
            return '#f59e0b'
        case 'pending':
            return 'var(--app-hint)'
        default:
            return '#10b981'
    }
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text
    return `${text.slice(0, max - 1)}…`
}

function filterGraphToNodes(graph: TraceGraph, visible: TraceNode[]): TraceGraph {
    const ids = new Set(visible.map((n) => n.id))
    return {
        nodes: visible,
        edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    }
}

export function SessionFlowGraph(props: {
    graph: TraceGraph
    nodes: TraceNode[]
}) {
    const { t } = useTranslation()
    const svgRef = useRef<SVGSVGElement>(null)
    const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 })
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)

    const layout = useMemo(
        () => layoutTraceGraph(filterGraphToNodes(props.graph, props.nodes)),
        [props.graph, props.nodes],
    )

    const selected = selectedId
        ? layout.nodes.find((n) => n.id === selectedId) ?? null
        : null

    const fit = useCallback(() => {
        const el = svgRef.current
        if (!el || layout.nodes.length === 0) return
        const rect = el.getBoundingClientRect()
        const pad = 32
        const kw = (rect.width - pad * 2) / Math.max(layout.width, 1)
        const kh = (rect.height - pad * 2) / Math.max(layout.height, 1)
        const k = Math.min(1.15, Math.max(0.25, Math.min(kw, kh)))
        setView({
            k,
            x: (rect.width - layout.width * k) / 2,
            y: Math.max(12, (rect.height - layout.height * k) / 2),
        })
    }, [layout.height, layout.nodes.length, layout.width])

    useEffect(() => {
        fit()
    }, [fit])

    const onWheel = (e: WheelEvent<SVGSVGElement>) => {
        e.preventDefault()
        const el = svgRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        setView((v) => {
            const nextK = Math.min(2.5, Math.max(0.2, v.k * factor))
            const wx = (mx - v.x) / v.k
            const wy = (my - v.y) / v.k
            return {
                k: nextK,
                x: mx - wx * nextK,
                y: my - wy * nextK,
            }
        })
    }

    const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
        if (e.button !== 0) return
        const target = e.target as Element
        if (target.closest('[data-flow-node]')) return
        drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
        const d = drag.current
        if (!d) return
        setView((v) => ({
            ...v,
            x: d.vx + (e.clientX - d.px),
            y: d.vy + (e.clientY - d.py),
        }))
    }

    const onPointerUp = () => {
        drag.current = null
    }

    if (layout.nodes.length === 0) {
        return (
            <div className="text-sm text-[var(--app-hint)]">{t('session.flow.graphEmpty')}</div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--app-hint)]">{t('session.flow.graphHint')}</span>
                <button
                    type="button"
                    onClick={fit}
                    className="rounded px-2 py-0.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]"
                >
                    {t('session.flow.graphFit')}
                </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)]">
                <svg
                    ref={svgRef}
                    className="block h-[min(52vh,420px)] w-full touch-none cursor-grab active:cursor-grabbing"
                    onWheel={onWheel}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    role="img"
                    aria-label={t('session.flow.graph')}
                >
                    <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                        {layout.edges.map((edge) => (
                            <path
                                key={`${edge.from}->${edge.to}:${edge.kind}`}
                                d={edgePath(edge)}
                                fill="none"
                                stroke={edge.kind === 'spawn' ? 'var(--app-accent, #6366f1)' : 'var(--app-border)'}
                                strokeWidth={edge.kind === 'spawn' ? 2 : 1.5}
                                strokeDasharray={edge.kind === 'spawn' ? '4 3' : undefined}
                                markerEnd="url(#flow-arrow)"
                            />
                        ))}
                        <defs>
                            <marker
                                id="flow-arrow"
                                viewBox="0 0 10 10"
                                refX="8"
                                refY="5"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto-start-reverse"
                            >
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--app-hint)" />
                            </marker>
                        </defs>
                        {layout.nodes.map((node) => (
                            <FlowNode
                                key={node.id}
                                node={node}
                                selected={node.id === selectedId}
                                onSelect={() => setSelectedId((id) => (id === node.id ? null : node.id))}
                            />
                        ))}
                    </g>
                </svg>
            </div>
            {selected ? <SelectedNodeDetail node={selected} /> : null}
        </div>
    )
}

function FlowNode(props: {
    node: LaidOutNode
    selected: boolean
    onSelect: () => void
}) {
    const { node, selected, onSelect } = props
    const label = node.count > 1 ? `${node.label} ×${node.count}` : node.label
    const isSub = node.kind === 'subagent'
    return (
        <g
            data-flow-node={node.id}
            transform={`translate(${node.x} ${node.y})`}
            onClick={(e) => {
                e.stopPropagation()
                onSelect()
            }}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect()
                }
            }}
        >
            <rect
                width={node.w}
                height={node.h}
                rx={isSub ? 10 : 8}
                fill="var(--app-subtle-bg)"
                stroke={selected ? 'var(--app-fg)' : 'var(--app-border)'}
                strokeWidth={selected ? 2 : 1}
            />
            <circle cx={14} cy={node.h / 2} r={5} fill={stateFill(node.state)} />
            <text
                x={26}
                y={isSub && node.detail ? node.h / 2 - 6 : node.h / 2 + 4}
                className="fill-[var(--app-fg)]"
                style={{ fontSize: isSub ? 12 : 11, fontWeight: isSub ? 600 : 500 }}
            >
                {truncate(label, isSub ? 26 : 18)}
            </text>
            {isSub && node.detail ? (
                <text
                    x={26}
                    y={node.h / 2 + 12}
                    className="fill-[var(--app-hint)]"
                    style={{ fontSize: 10 }}
                >
                    {truncate(node.detail, 28)}
                </text>
            ) : null}
            <title>{node.detail ? `${label}\n${node.detail}` : label}</title>
        </g>
    )
}

function SelectedNodeDetail(props: { node: LaidOutNode }) {
    const { t } = useTranslation()
    const { node } = props
    return (
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm">
            <div className="font-semibold">{node.label}{node.count > 1 ? ` ×${node.count}` : ''}</div>
            {node.detail ? (
                <div className="mt-0.5 break-all font-mono text-xs text-[var(--app-hint)]">{node.detail}</div>
            ) : null}
            <div className="mt-1 text-xs text-[var(--app-hint)]">
                {node.kind === 'subagent'
                    ? node.childCount > 0
                        ? t('session.flow.subagentSteps', { n: node.childCount })
                        : t('session.flow.subagentOpaque')
                    : node.flowKind}
            </div>
        </div>
    )
}
