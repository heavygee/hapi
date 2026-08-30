import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import {
    compactUrlLabel,
    eventMatchesSessionLogQuery,
    parseSessionLogMessageId,
    sessionLogTargetMessageIds,
    SessionLogPanel
} from '@/components/AssistantChat/SessionLogPanel'
import type { ApiClient } from '@/api/client'
import type { SystemEventRow } from '@/types/systemEvents'

const NOW = Date.now()
const HUB_MESSAGE_ID = 'msg-hub-uuid-1'

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
        payloadJson: JSON.stringify({ messageId: HUB_MESSAGE_ID, url: 'https://example.com/pr/1' }),
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
        payloadJson: JSON.stringify({ messageId: HUB_MESSAGE_ID }),
        severity: 1
    },
    {
        id: 4,
        ts: NOW - 90_000,
        sourceKind: 'system',
        sourceRef: 'sess-1',
        eventType: 'approval_requested',
        attentionCandidate: 1,
        summary: 'Permission requested: Bash',
        artifactRefs: null,
        provenance: 'hub-inferred from permission prompt',
        relatedSessionId: 'sess-1',
        payloadJson: JSON.stringify({ requestId: 'req-1' }),
        severity: 2
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
    const onSelectMessage = props.onSelectMessage ?? vi.fn()

    const view = render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SessionLogPanel
                    api={api}
                    sessionId="sess-1"
                    title="demo project"
                    onClose={vi.fn()}
                    {...props}
                    onSelectMessage={onSelectMessage}
                />
            </I18nProvider>
        </QueryClientProvider>
    )

    return {
        ...view,
        fetchSystemEvents,
        api,
        onSelectMessage: onSelectMessage as ReturnType<typeof vi.fn>
    }
}

describe('compactUrlLabel', () => {
    it('drops scheme and truncates long paths', () => {
        expect(compactUrlLabel('https://example.com/pr/1')).toBe('example.com/pr/1')
        expect(compactUrlLabel(`https://github.com/tiann/hapi/pull/${'9'.repeat(80)}`, 40)).toMatch(/…$/)
    })
})

describe('parseSessionLogMessageId', () => {
    it('reads messageId from payloadJson', () => {
        expect(parseSessionLogMessageId(JSON.stringify({ messageId: HUB_MESSAGE_ID }))).toBe(HUB_MESSAGE_ID)
    })

    it('returns null when messageId is missing or payload is invalid', () => {
        expect(parseSessionLogMessageId(null)).toBeNull()
        expect(parseSessionLogMessageId('{')).toBeNull()
        expect(parseSessionLogMessageId(JSON.stringify({ requestId: 'x' }))).toBeNull()
        expect(parseSessionLogMessageId(JSON.stringify({ messageId: 12 }))).toBeNull()
        expect(parseSessionLogMessageId(JSON.stringify({ messageId: '  ' }))).toBeNull()
    })
})

describe('sessionLogTargetMessageIds', () => {
    it('prefers agent-text block ids Outline/DOM use (kind:hubId:idx)', () => {
        expect(sessionLogTargetMessageIds(HUB_MESSAGE_ID)[0]).toBe(`agent-text:${HUB_MESSAGE_ID}:0`)
        expect(sessionLogTargetMessageIds(HUB_MESSAGE_ID)).toContain(`agent-text:${HUB_MESSAGE_ID}`)
    })
})

describe('eventMatchesSessionLogQuery', () => {
    it('matches summary and URL labels case-insensitively', () => {
        const event = sampleEvents[0]
        expect(eventMatchesSessionLogQuery(event, 'EXAMPLE')).toBe(true)
        expect(eventMatchesSessionLogQuery(event, 'pr/1')).toBe(true)
        expect(eventMatchesSessionLogQuery(event, 'nope')).toBe(false)
        expect(eventMatchesSessionLogQuery(event, '  ')).toBe(true)
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

    it('clicks a notify row with messageId and invokes onSelectMessage', async () => {
        const { onSelectMessage } = renderPanel()

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: /Working on Session Log/i }))
        expect(onSelectMessage).toHaveBeenCalledWith(HUB_MESSAGE_ID)
    })

    it('does not make rows without messageId clickable', async () => {
        const { onSelectMessage } = renderPanel()

        await waitFor(() => {
            expect(screen.getByText('Permission requested: Bash')).toBeInTheDocument()
        })

        expect(screen.queryByRole('button', { name: /Permission requested: Bash/i })).not.toBeInTheDocument()
        fireEvent.click(screen.getByText('Permission requested: Bash'))
        expect(onSelectMessage).not.toHaveBeenCalled()
    })

    it('Links tab keeps external URL and row click still jumps when messageId present', async () => {
        const fetchSystemEvents = vi.fn(async (params: { eventType?: string }) => {
            if (params.eventType === 'link_seen') {
                return { total: 1, events: [sampleEvents[0]] }
            }
            return { total: sampleEvents.length, events: sampleEvents }
        })
        const { onSelectMessage } = renderPanel({}, fetchSystemEvents as ApiClient['fetchSystemEvents'])

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

        fireEvent.click(screen.getByRole('button', { name: /example.com\/pr\/1/i }))
        expect(onSelectMessage).toHaveBeenCalledWith(HUB_MESSAGE_ID)

        onSelectMessage.mockClear()
        fireEvent.click(screen.getByRole('link', { name: 'example.com/pr/1' }))
        expect(onSelectMessage).not.toHaveBeenCalled()
    })

    it('Pinned tab lists operator_pin events and filter box narrows summaries', async () => {
        const pinEvent: SystemEventRow = {
            id: 9,
            ts: NOW - 10_000,
            sourceKind: 'operator',
            sourceRef: 'sess-1',
            eventType: 'operator_pin',
            attentionCandidate: 0,
            summary: 'Pinned summary about rematerialize hold',
            artifactRefs: null,
            provenance: 'operator pin',
            relatedSessionId: 'sess-1',
            payloadJson: JSON.stringify({ messageId: HUB_MESSAGE_ID }),
            severity: 1
        }
        const fetchSystemEvents = vi.fn(async (params: { eventType?: string }) => {
            if (params.eventType === 'operator_pin') {
                return { total: 1, events: [pinEvent] }
            }
            return { total: sampleEvents.length, events: sampleEvents }
        })
        renderPanel({}, fetchSystemEvents as ApiClient['fetchSystemEvents'])

        await waitFor(() => {
            expect(screen.getByText('Working on Session Log')).toBeInTheDocument()
        })

        const filters = screen.getByLabelText('Log filters')
        fireEvent.click(within(filters).getByText('Pinned'))

        await waitFor(() => {
            expect(screen.getByText('Pinned summary about rematerialize hold')).toBeInTheDocument()
        })

        fireEvent.change(screen.getByPlaceholderText('Filter summaries…'), {
            target: { value: 'rematerialize' }
        })
        expect(screen.getByText('Pinned summary about rematerialize hold')).toBeInTheDocument()

        fireEvent.change(screen.getByPlaceholderText('Filter summaries…'), {
            target: { value: 'zzzz-missing' }
        })
        await waitFor(() => {
            expect(screen.getByText('No summaries match this filter')).toBeInTheDocument()
        })
    })
})
