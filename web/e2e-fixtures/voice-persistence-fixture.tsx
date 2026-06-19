import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { VoiceReceivingIcon } from '../src/components/VoiceReceivingIcon'
import type { SessionSummary } from '../src/types/api'

declare global {
    interface Window {
        __voicePersistenceE2E?: {
            route: 'session-a' | 'session-b' | 'settings'
            receivingSessionId: string
            setRoute(route: 'session-a' | 'session-b' | 'settings'): void
        }
    }
}

const sessions: SessionSummary[] = [
    {
        id: 'session-a',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { name: 'Alpha worker' },
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
    },
    {
        id: 'session-b',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { name: 'Beta worker' },
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
    },
]

const RECEIVING_SESSION_ID = 'session-a'

function SessionCard(props: { session: SessionSummary; voiceReceiving: boolean; selected: boolean }) {
    return (
        <div
            data-testid={`session-card-${props.session.id}`}
            data-selected={props.selected ? 'true' : 'false'}
            className="rounded-lg border border-[var(--app-border)] px-3 py-2"
        >
            <div className="flex items-center gap-2">
                <span>{props.session.metadata?.title}</span>
                {props.voiceReceiving ? (
                    <span data-testid="voice-receiving-indicator" className="text-[var(--app-link)]">
                        <VoiceReceivingIcon />
                    </span>
                ) : null}
            </div>
        </div>
    )
}

function FixtureApp() {
    const [route, setRoute] = useState<'session-a' | 'session-b' | 'settings'>('session-a')

    useEffect(() => {
        window.__voicePersistenceE2E = {
            route,
            receivingSessionId: RECEIVING_SESSION_ID,
            setRoute,
        }
    }, [route])

    const selectedSessionId = route === 'settings' ? null : route

    return (
        <I18nProvider>
            <div
                data-testid="voice-focus-pill"
                className="mb-3 rounded-full border px-3 py-1 text-sm"
                role="status"
            >
                voice → Alpha worker
            </div>
            <div className="flex flex-col gap-3">
                <div data-testid="route-label">route:{route}</div>
                <div className="flex gap-2">
                    <button type="button" data-testid="nav-session-a" onClick={() => setRoute('session-a')}>Session A</button>
                    <button type="button" data-testid="nav-session-b" onClick={() => setRoute('session-b')}>Session B</button>
                    <button type="button" data-testid="nav-settings" onClick={() => setRoute('settings')}>Settings</button>
                </div>
                {route === 'settings' ? (
                    <div data-testid="settings-view">Settings view</div>
                ) : (
                    <div data-testid="session-view">Session view for {route}</div>
                )}
                <div className="flex flex-col gap-1">
                    {sessions.map((session) => (
                        <SessionCard
                            key={session.id}
                            session={session}
                            selected={session.id === selectedSessionId}
                            voiceReceiving={session.id === RECEIVING_SESSION_ID}
                        />
                    ))}
                </div>
            </div>
        </I18nProvider>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <FixtureApp />
    </React.StrictMode>
)
