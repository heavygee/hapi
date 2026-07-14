/*
 * Standalone fixture for EventsDebugControls Playwright smoke (#22).
 * Mocks ApiClient.fetchSystemEvents so the panel renders without hub auth.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { AppContextProvider } from '../src/lib/app-context'
import { EventsDebugControls } from '../src/components/settings/EventsDebugControls'
import type { ApiClient } from '../src/api/client'

declare global {
    interface Window {
        __eventsDebugE2E?: {
            setEvents(events: Array<{
                id: number
                ts: number
                sourceKind: string
                sourceRef: string | null
                eventType: string
                attentionCandidate: number
                summary: string
                provenance: string | null
                relatedSessionId: string | null
                payloadJson: string | null
                severity: number | null
            }>): void
            setError(message: string | null): void
        }
    }
}

const sampleEvents = [
    {
        id: 1,
        ts: Date.UTC(2026, 5, 19, 12, 0, 0),
        sourceKind: 'agent',
        sourceRef: 'cursor',
        eventType: 'completed',
        attentionCandidate: 0,
        summary: 'Substrate smoke event',
        provenance: 'notify_summary',
        relatedSessionId: 'sess-smoke-01',
        payloadJson: null,
        severity: null,
    },
]

function createMockApi(): ApiClient {
    let events = [...sampleEvents]
    let shouldFail = false

    const api = {
        async fetchSystemEvents() {
            if (shouldFail) {
                throw new Error('fixture fetch failed')
            }
            return { total: events.length, events }
        },
    } as unknown as ApiClient

    window.__eventsDebugE2E = {
        setEvents(next) {
            events = next
        },
        setError(message) {
            shouldFail = message !== null
        },
    }

    return api
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
    <AppContextProvider value={{ api: createMockApi(), token: 'fixture', baseUrl: '' }}>
        <div data-testid="events-debug-fixture">
            <EventsDebugControls />
        </div>
    </AppContextProvider>
)
