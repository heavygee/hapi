import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionLogPanel } from '@/components/AssistantChat/SessionLogPanel'
import type { ApiClient } from '@/api/client'
import type { SystemEventRow } from '@/types/systemEvents'

const sampleEvents: SystemEventRow[] = [
    {
        id: 2,
        ts: 1_700_000_000_200,
        sourceKind: 'system',
        sourceRef: 'sess-1',
        eventType: 'link_seen',
        attentionCandidate: 0,
        summary: 'Link seen: https://example.com/pr/1',
        artifactRefs: JSON.stringify([{ kind: 'url', url: 'https://example.com/pr/1' }]),
        provenance: 'hub-inferred from message URL scoop',
        relatedSessionId: 'sess-1',
        payloadJson: null,
        severity: 1
    },
    {
        id: 1,
        ts: 1_700_000_000_100,
        sourceKind: 'worker',
        sourceRef: 'sess-1',
        eventType: 'progress',
        attentionCandidate: 0,
        summary: 'Working on Session Log',
        artifactRefs: null,
        provenance: null,
        relatedSessionId: 'sess-1',
        payloadJson: null,
        severity: 1
    }
]

function renderPanel(
    props: Partial<ComponentProps<typeof SessionLogPanel>> = {},
    fetchImpl?: ApiClient['fetchSystemEvents']
) {
    const fetchSystemEvents = vi.fn(fetchImpl ?? (async () => ({
        total: sampleEvents.length,
        events: sampleEvents
    })))
    const api = { fetchSystemEvents } as unknown as ApiClient
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    })

    const view = render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SessionLogPanel
                    api={api}
                    sessionId="sess-1"
                    title="demo project"
                    onClose={vi.fn()}
                    {...props}
                />
            </I18nProvider>
        </QueryClientProvider>
    )

    return { ...view, fetchSystemEvents, api }
}

describe('SessionLogPanel', () => {
    afterEach(() => {
        cleanup()
    })

    it('lists durable session events from the system-events API', async () => {
        const { fetchSystemEvents } = renderPanel()

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })
        expect(screen.getByText('Link seen: https://example.com/pr/1')).toBeInTheDocument()
        expect(fetchSystemEvents).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'sess-1',
            limit: 100
        }))
        expect(screen.getByRole('link', { name: 'https://example.com/pr/1' })).toHaveAttribute(
            'href',
            'https://example.com/pr/1'
        )
    })

    it('filters to link_seen via the Links tab', async () => {
        const fetchSystemEvents = vi.fn(async (params: { eventType?: string }) => {
            if (params.eventType === 'link_seen') {
                return { total: 1, events: [sampleEvents[0]] }
            }
            return { total: sampleEvents.length, events: sampleEvents }
        })
        renderPanel({}, fetchSystemEvents as ApiClient['fetchSystemEvents'])

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })

        const filters = screen.getByLabelText('Log filters')
        fireEvent.click(within(filters).getByText('Links'))

        await waitFor(() => {
            expect(fetchSystemEvents).toHaveBeenCalledWith(expect.objectContaining({
                sessionId: 'sess-1',
                eventType: 'link_seen'
            }))
        })
        await waitFor(() => {
            expect(screen.queryByText('Working on Session Log')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Link seen: https://example.com/pr/1')).toBeInTheDocument()
    })

    it('renders empty state when no events exist', async () => {
        renderPanel({}, async () => ({ total: 0, events: [] }))

        await waitFor(() => {
            expect(screen.getByText('No durable events for this session yet')).toBeInTheDocument()
        })
    })
})
