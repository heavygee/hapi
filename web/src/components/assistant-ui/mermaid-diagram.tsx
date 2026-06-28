import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'

let initializedTheme: 'light' | 'dark' | null = null
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

async function getMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then((module) => module.default)
    }
    return mermaidPromise
}

function resolveTheme() {
    if (typeof document === 'undefined') return 'light' as const
    const theme = document.documentElement.dataset.theme
    return theme === 'dark' || theme === 'oled' ? 'dark' as const : 'light' as const
}

async function ensureMermaid(theme: 'light' | 'dark') {
    const mermaid = await getMermaid()
    if (initializedTheme === theme) return mermaid

    mermaid.setParseErrorHandler(() => undefined)

    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: theme === 'dark' ? 'dark' : 'default',
        themeVariables: theme === 'dark'
            ? {
                primaryColor: '#323843',
                primaryTextColor: '#edf1f5',
                primaryBorderColor: '#6d8fd6',
                lineColor: '#94a3b8',
                tertiaryColor: '#2d3440',
                background: '#2a2f35',
                mainBkg: '#323843',
                secondBkg: '#2d3440',
                tertiaryBkg: '#29313b',
                clusterBkg: '#2d3440',
                clusterBorder: '#6d8fd6',
                edgeLabelBackground: '#2a2f35',
            }
            : {
                primaryColor: '#f8fbff',
                primaryTextColor: '#2d333b',
                primaryBorderColor: '#b8cdfd',
                lineColor: '#94a3b8',
                tertiaryColor: '#eef4ff',
                background: '#f5f6f7',
                mainBkg: '#f8fbff',
                secondBkg: '#eef4ff',
                tertiaryBkg: '#edf3fb',
                clusterBkg: '#eef4ff',
                clusterBorder: '#b8cdfd',
                edgeLabelBackground: '#f5f6f7',
            },
    })

    initializedTheme = theme
    return mermaid
}

function MermaidRenderError({ className }: { className?: string }) {
    return (
        <div
            data-mermaid-diagram
            data-rendered="false"
            className={cn(
                'aui-mermaid-render-error flex min-h-[160px] items-center justify-center rounded-b-xl bg-[var(--app-code-bg)] px-6 py-8',
                className
            )}
        >
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                    <svg
                        className="h-6 w-6"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-[var(--app-fg)]">
                        Diagram rendering failed
                    </p>
                    <p className="text-xs leading-relaxed text-[var(--app-fg)]/60">
                        The agent used an unrecognised diagram type. It has been notified and
                        will provide a corrected version below.
                    </p>
                </div>
            </div>
        </div>
    )
}

type RenderState = 'pending' | 'error' | 'success'

export function MermaidDiagram(props: SyntaxHighlighterProps) {
    const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme())
    const [state, setState] = useState<RenderState>('pending')
    const [svg, setSvg] = useState<string | null>(null)
    const id = useId().replace(/:/g, '-')

    useEffect(() => {
        if (typeof document === 'undefined') return undefined

        const root = document.documentElement
        const observer = new MutationObserver(() => {
            setTheme(resolveTheme())
        })

        observer.observe(root, {
            attributes: true,
            attributeFilter: ['data-theme'],
        })

        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        let cancelled = false
        setState('pending')
        setSvg(null)

        const render = async () => {
            try {
                const mermaid = await ensureMermaid(theme)
                const isValid = await mermaid.parse(props.code, { suppressErrors: true })
                if (cancelled) return
                if (!isValid) {
                    setState('error')
                    return
                }

                const result = await mermaid.render(`mermaid-${id}`, props.code)
                if (cancelled) return
                setSvg(result.svg)
                setState('success')
            } catch {
                if (cancelled) return
                setState('error')
            }
        }

        void render()

        return () => {
            cancelled = true
        }
    }, [id, props.code, theme])

    if (state === 'error') {
        return <MermaidRenderError />
    }

    if (state === 'success' && svg) {
        return (
            <div
                data-mermaid-diagram
                data-rendered="true"
                className="aui-mermaid-diagram overflow-x-auto rounded-b-xl bg-[var(--app-code-bg)] px-4 py-3"
            >
                <div
                    className="min-w-fit [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            </div>
        )
    }

    // pending: render a silent skeleton matching the diagram area height
    return (
        <div
            data-mermaid-diagram
            data-rendered="pending"
            className="min-h-[160px] animate-pulse rounded-b-xl bg-[var(--app-code-bg)] opacity-40"
        />
    )
}
