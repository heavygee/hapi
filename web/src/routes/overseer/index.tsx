import { useEffect, useState } from 'react'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { OverseerBrainPanel } from '@/components/overseer/OverseerBrainPanel'
import { OverseerChatDebugControls } from '@/components/settings/OverseerChatDebugControls'
import { EventsDebugControls } from '@/components/settings/EventsDebugControls'
import { InboxDebugControls } from '@/components/settings/InboxDebugControls'
import type { OverseerIdentity } from '@hapi/protocol'

function BackIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function OverseerIdentityPanel() {
    const { api } = useAppContext()
    const [identity, setIdentity] = useState<OverseerIdentity | null>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!api) return
        void api.fetchOverseerIdentity()
            .then((res) => setIdentity(res.identity))
            .catch(() => { /* identity is optional chrome */ })
    }, [api])

    if (!identity) return null

    return (
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                aria-expanded={open}
            >
                <span className="text-sm font-semibold text-[var(--app-fg)]">Identity &amp; tools</span>
                <span className="text-xs text-[var(--app-hint)]">
                    {identity.id} · {identity.tools.length} tool{identity.tools.length === 1 ? '' : 's'}
                    {identity.canDisposition ? ' · can disposition' : ''}
                </span>
            </button>
            {open ? (
                <div className="space-y-2 border-t border-[var(--app-divider)] px-3 py-2">
                    <ul className="space-y-1">
                        {identity.tools.map((tool) => (
                            <li key={tool.name} className="text-[11px] text-[var(--app-hint)]">
                                <span className={tool.readonly ? 'text-emerald-500' : 'text-amber-500'}>
                                    {tool.readonly ? 'read ' : 'write'}
                                </span>{' '}
                                <span className="font-mono text-[var(--app-fg)]">{tool.name}</span>
                                {' — '}{tool.description}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}

export default function OverseerConsolePage() {
    const goBack = useAppGoBack()

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        aria-label="Back"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">Overseer</div>
            </div>

            <div className="app-scroll-y flex-1 min-h-0">
                <div className="mx-auto w-full max-w-content space-y-3 p-3">
                    <OverseerBrainPanel />
                    <OverseerIdentityPanel />

                    <div className="overflow-hidden rounded-lg border border-[var(--app-border)]">
                        <OverseerChatDebugControls />
                        <EventsDebugControls />
                        <InboxDebugControls />
                    </div>
                </div>
            </div>
        </div>
    )
}
