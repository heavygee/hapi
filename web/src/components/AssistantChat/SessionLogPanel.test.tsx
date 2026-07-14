import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import { compactUrlLabel, SessionLogPanel } from '@/components/AssistantChat/SessionLogPanel'
import type { ApiClient } from '@/api/client'
import type { SystemEventRow } from '@/types/systemEvents'

const NOW = Date.now()

const sampleEvents: SystemEventRow[] = [
    {
        id: 2,
        ts: NOW - 5 * 60_000,
        sourceKind: 'system',
        sourceRef: 'sess-1',
        eventType: 'link_seen',
        attentionCandidate: 0,
        summary: 'Link seen: example.com/pr/1',
        artifactRefs: JSON.stringify([{ kind: 'url', url: 'https://example.com/pr/1' }]),
        provenance: 'hub-inferred from message URL scoop',
        relatedSessionId: 'sess-1',
        payloadJson: null,
        severity: 1
    },
    {
        id: 1,
        ts: NOW - 2 * 60_000,
        sourceKind: 'worker',
        sourceRef: 'sess-1',
        eventType: 'progress',
        attentionCandidate: 0,
        summary: 'Working on Session Log',
        artifactRefs: null,
        provenance: 'AGENT_NOTIFY_SUMMARY',
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

describe('compactUrlLabel', () => {
    it('drops scheme and truncates long paths', () => {
        expect(compactUrlLabel('https://example.com/pr/1')).toBe('example.com/pr/1')
        expect(compactUrlLabel(`https://github.com/tiann/hapi/pull/${'9'.repeat(80)}`, 40)).toMatch(/…$/)
    })
})

describe('SessionLogPanel', () => {
    afterEach(() => {
        cleanup()
    })

    it('lists All rows with relative time, no provenance clutter', async () => {
        renderPanel()

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })
        expect(screen.getByText('2m ago')).toBeInTheDocument()
        expect(screen.queryByText(/Source:/)).not.toBeInTheDocument()
        expect(screen.queryByText('AGENT_NOTIFY_SUMMARY')).not.toBeInTheDocument()
        expect(screen.queryByText(/Link seen:/)).not.toBeInTheDocument()
    })

    it('Links tab shows one clickable compact label (not summary + URL)', async () => {
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
            expect(screen.getByRole('link', { name: 'example.com/pr/1' })).toHaveAttribute(
                'href',
                'https://example.com/pr/1'
            )
        })
        expect(screen.queryByText(/Link seen:/)).not.toBeInTheDocument()
        expect(screen.queryByText('LINK_SEEN', { exact: false })).not.toBeInTheDocument()
        expect(screen.queryByText(/hub-inferred/)).not.toBeInTheDocument()
        expect(screen.getByText('5m ago')).toBeInTheDocument()
    })

    it('hides historical stale rows from the All tab', async () => {
        renderPanel({}, async () => ({
            total: 2,
            events: [
                {
                    id: 3,
                    ts: NOW - 30_000,
                    sourceKind: 'system',
                    sourceRef: 'sess-1',
                    eventType: 'stale',
                    attentionCandidate: 0,
                    summary: 'No agent output for 30 minutes',
                    artifactRefs: null,
                    provenance: 'hub-inferred from session silence threshold',
                    relatedSessionId: 'sess-1',
                    payloadJson: null,
                    severity: 3
                },
                sampleEvents[1]
            ]
        }))

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })
        expect(screen.queryByText('No agent output for 30 minutes')).not.toBeInTheDocument()
    })

    it('renders empty state when no events exist', async () => {
        renderPanel({}, async () => ({ total: 0, events: [] }))

        await waitFor(() => {
            expect(screen.getByText('No durable events for this session yet')).toBeInTheDocument()
        })
    })
})
