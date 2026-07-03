/*
 * Standalone fixture for InboxDebugControls Playwright smoke (#23).
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { AppContextProvider } from '../src/lib/app-context'
import { InboxDebugControls } from '../src/components/settings/InboxDebugControls'
import type { ApiClient } from '../src/api/client'

declare global {
    interface Window {
        __inboxDebugE2E?: {
            setItems(items: Array<{
                id: number
                status: string
                priority: number
                basePriority: number
                title: string
                category: string
                summary: string
                suggestedAction: string | null
                reasonForPriority: string | null
                sourceEventIds: number[]
                relatedSessionId: string | null
                createdAt: number
                updatedAt: number
            }>): void
            setError(message: string | null): void
        }
    }
}

const sampleItems = [
    {
        id: 1,
        status: 'new',
        priority: 20,
        basePriority: 20,
        title: 'feat: inbox substrate',
        category: 'BLOCKED',
        summary: 'CI auth failed on push',
        suggestedAction: 'Fix GitHub token',
        reasonForPriority: 'BLOCKED tier · queued 12m ago · from event #42',
        sourceEventIds: [42],
        relatedSessionId: 'sess-smoke-01',
        createdAt: Date.UTC(2026, 5, 19, 12, 0, 0),
        updatedAt: Date.UTC(2026, 5, 19, 12, 0, 0),
    },
]

function createMockApi(): ApiClient {
    let items = [...sampleItems]
    let shouldFail = false

    const api = {
        async fetchInboxItems() {
            if (shouldFail) {
                throw new Error('fixture fetch failed')
            }
            return { total: items.length, items }
        },
        async recordInboxOperatorAction(itemId: number, action: string) {
            items = items.map((item) => (
                item.id === itemId
                    ? { ...item, status: action === 'done' ? 'resolved' : item.status, updatedAt: Date.now() }
                    : item
            ))
            return { item: items.find((item) => item.id === itemId) }
        },
    } as unknown as ApiClient

    window.__inboxDebugE2E = {
        setItems(next) {
            items = next
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
        <div data-testid="inbox-debug-fixture">
            <InboxDebugControls />
        </div>
    </AppContextProvider>
)
