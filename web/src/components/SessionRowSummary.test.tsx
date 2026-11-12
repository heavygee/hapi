import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { markSessionSeen, markSessionUnread } from '@/lib/sessionLastSeen'
import { SessionRowSummary } from './SessionRowSummary'

afterEach(() => cleanup())

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 'background-demo',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path: '/demo/status', name: 'Background demo', flavor: 'claude' },
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 2,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        attachedJob: null,
        attachedJobUpdatedAt: 0,
        model: null,
        effort: null,
        contentRevision: overrides.updatedAt ?? 0,
        ...overrides
    }
}

function renderSummary(showDetailedStatus: boolean) {
    return render(
        <I18nProvider>
            <SessionRowSummary
                session={makeSummary()}
                showDetailedStatus={showDetailedStatus}
            />
        </I18nProvider>
    )
}

describe('SessionRowSummary background status', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('draws the background spinner with the thinking spinner markup, only in blue', () => {
        const background = renderSummary(false).container.querySelector('svg.animate-spin-slow')
        cleanup()
        const thinking = render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ thinking: true, backgroundTaskCount: 0 })} />
            </I18nProvider>
        ).container
        expect(thinking.querySelector('[data-testid="session-presence"]'))
            .toHaveClass('bg-[var(--app-badge-success-text)]', 'animate-pulse')
        expect(thinking.querySelector('[data-testid="session-presence"]')).toHaveAttribute('data-presence', 'working')
        expect(screen.queryByText('Running', { exact: true })).not.toBeInTheDocument()
        cleanup()

        const idle = render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ backgroundTaskCount: 0 })} />
            </I18nProvider>
        ).container
        const idleBadge = idle.querySelector('[data-testid="session-presence"]')
        expect(idleBadge).toHaveAttribute('data-presence', 'waiting')
        expect(idleBadge).not.toHaveClass('animate-pulse')
        expect(idleBadge).toHaveClass('border-2', 'border-[var(--app-badge-success-text)]')
        expect(idleBadge).not.toHaveClass('bg-[var(--app-badge-success-text)]')
    })

    // The merge resurrected the 832c5922f-era version of this test, which
    // asserted the INVERSE ('does not dim') and had been superseded on both
    // sides -- it also contradicted 'fades inactive rows' further down this
    // same file. This is upstream's current version, which agrees with the
    // fork's behaviour.
    it('dims disconnected rows and gives them a stopped badge instead of nothing', () => {
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ active: false, backgroundTaskCount: 0 })} />
            </I18nProvider>
        )
        // Two scales of the same fact: the badge names the state on inspection,
        // the row fade makes it legible while scanning a long list.
        const faded = container.querySelector('.opacity-50')
        expect(faded).not.toBeNull()
        const badge = container.querySelector('[data-testid="session-presence"]')
        expect(badge).toHaveAttribute('data-presence', 'stopped')
        expect(badge).not.toHaveClass('animate-pulse')
        expect(badge?.querySelector('svg')).not.toBeNull()
        // The mark must not be dimmed along with the title line.
        expect(faded!.contains(badge)).toBe(false)
    })

    it('shows a detailed background tooltip on the agent icon in Extended mode', () => {
        renderSummary(true)

        expect(screen.queryByText('Running', { exact: true })).not.toBeInTheDocument()
        const tooltip = screen.getByRole('tooltip', { hidden: true })
        expect(tooltip).toHaveTextContent('Background tasks running')
        expect(tooltip).toHaveTextContent('2 tasks running')
    })

    it('refreshes unread attention when the local watermark version changes', () => {
        const session = makeSummary({
            active: false,
            backgroundTaskCount: 0,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        const view = render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expect(screen.queryByTestId('session-unread')).not.toBeInTheDocument()

        markSessionUnread(session.id)
        view.rerender(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    showDetailedStatus={true}
                    lastSeenVersion={1}
                />
            </I18nProvider>
        )

        expectUnreadOnce()
    })

    it('shows an explicit unread dot for the selected session only', () => {
        const session = makeSummary({
            id: 'selected-unread',
            active: false,
            backgroundTaskCount: 0,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        markSessionUnread(session.id)

        const view = render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expectUnreadOnce()

        // Manual unread persists across newer content revisions.
        view.rerender(
            <I18nProvider>
                <SessionRowSummary
                    session={{ ...session, updatedAt: 2_001, contentRevision: 2_001 }}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={1}
                />
            </I18nProvider>
        )

        expectUnreadOnce()
    })

    it('shows an explicit unread dot before the thinking spinner', () => {
        const session = makeSummary({
            id: 'selected-thinking-unread',
            thinking: true,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        markSessionUnread(session.id)

        render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expectUnreadOnce()
        // Thinking spinner is a second chrome element — not a second unread dot.
        expect(document.querySelectorAll('[data-testid="session-unread"]')).toHaveLength(1)
    })

    it('shows and clears the unread dot in standard session rows', () => {
        const session = makeSummary({ id: 'standard-unread', backgroundTaskCount: 0, contentRevision: 5 })
        const view = render(<I18nProvider><SessionRowSummary session={session} showDetailedStatus={false} lastSeenVersion={0} /></I18nProvider>)
        expect(screen.getByTestId('session-unread')).toBeInTheDocument()
        markSessionSeen(session.id, 5)
        view.rerender(<I18nProvider><SessionRowSummary session={session} showDetailedStatus={false} lastSeenVersion={1} /></I18nProvider>)
        expect(screen.queryByTestId('session-unread')).toBeNull()
    })

    it('renders an issue chip linking to the latest-linked GitHub issue', () => {
        const session = makeSummary({
            metadata: {
                path: '/demo/status',
                name: 'Background demo',
                flavor: 'claude',
                externalRefs: [
                    { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 },
                    { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/236', repo: 'heavygee/hapi', number: 236, linkedAt: 2 },
                ],
            },
        })
        render(
            <I18nProvider>
                <SessionRowSummary session={session} />
            </I18nProvider>
        )

        const chip = screen.getByTestId('issue-ref-chip')
        expect(chip).toHaveTextContent('#236')
        expect(chip).toHaveAttribute('href', 'https://github.com/heavygee/hapi/issues/236')
    })

    it('renders no issue chip when the session has no linked issue', () => {
        renderSummary(true)
        expect(screen.queryByTestId('issue-ref-chip')).not.toBeInTheDocument()
    })

    it('suppresses the issue chip when showIssueChip is false, even with a linked issue (Codex review)', () => {
        // Regression: the composer's @-mention tooltip is pointer-events-none
        // (display-only), but a real <a> stays keyboard-focusable even
        // inside one, landing an unreachable-by-mouse link in the tab order
        // inside a transient role="tooltip" container.
        const session = makeSummary({
            metadata: {
                path: '/demo/status',
                name: 'Background demo',
                flavor: 'claude',
                externalRefs: [
                    { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 },
                ],
            },
        })
        render(
            <I18nProvider>
                <SessionRowSummary session={session} showIssueChip={false} />
            </I18nProvider>
        )

        expect(screen.queryByTestId('issue-ref-chip')).not.toBeInTheDocument()
    })
})

/** #2303 unread channel: one blue-500 dot + sr-only label — never a second attention tooltip. */
function expectUnreadOnce() {
    expect(screen.getByTestId('session-unread')).toBeInTheDocument()
    expect(screen.getByText('New activity')).toHaveClass('sr-only')
    expect(document.querySelectorAll('[data-testid="session-unread"]')).toHaveLength(1)
    expect(screen.queryAllByRole('tooltip', { hidden: true }).filter(node =>
        node.textContent?.includes('New activity')
    )).toHaveLength(0)
}

describe('SessionRowSummary residency fade', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('fades inactive rows even when a running attached job is present', () => {
        const now = Date.now()
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary({
                        active: false,
                        thinking: false,
                        backgroundTaskCount: 0,
                        attachedJob: {
                            key: 'dogfood',
                            label: 'dogfood countdown',
                            status: 'running',
                            remaining: 3600,
                            total: 172_800,
                            unit: 's',
                            startedAt: now - 3600_000,
                            heartbeatAt: now,
                            updatedAt: now,
                        },
                        attachedJobUpdatedAt: now,
                    })}
                />
            </I18nProvider>
        )

        expect(container.querySelector('.opacity-50')).not.toBeNull()
        expect(screen.getByText('dogfood countdown')).toBeInTheDocument()
    })

    it('does not fade active rows', () => {
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ active: true, backgroundTaskCount: 0 })} />
            </I18nProvider>
        )
        expect(container.querySelector('.opacity-50')).toBeNull()
    })
})

describe('SessionRowSummary attached job progress', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps a pulsing working badge for a running attached job after the agent stops', () => {
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary({
                        active: false,
                        backgroundTaskCount: 0,
                        attachedJob: {
                            key: 'import',
                            label: 'beets import',
                            status: 'running',
                            heartbeatAt: 1_000_000,
                            startedAt: 1_000_000 - 60_000,
                            updatedAt: 1_000_000,
                        },
                        attachedJobUpdatedAt: 1,
                    })}
                />
            </I18nProvider>
        )

        const badge = container.querySelector('[data-testid="session-presence"]')
        expect(badge).toHaveAttribute('data-presence', 'working')
        expect(badge).toHaveClass('animate-pulse')
    })

    it('renders a subtle indeterminate striped bar (no %) when fraction is unknown', () => {
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary({
                        backgroundTaskCount: 0,
                        attachedJob: {
                            key: 'countdown',
                            label: 'dogfood countdown',
                            status: 'running',
                            remaining: 172_800,
                            unit: 's',
                            heartbeatAt: 1_000_000,
                            startedAt: 1_000_000 - 60_000,
                            updatedAt: 1_000_000,
                        },
                        attachedJobUpdatedAt: 1,
                    })}
                />
            </I18nProvider>
        )

        expect(screen.getByText(/172800 s left/)).toBeInTheDocument()
        const bar = screen.getByTestId('attached-job-progress-bar')
        expect(bar).toHaveAttribute('data-progress', 'indeterminate')
        expect(bar).toHaveAttribute('role', 'progressbar')
        expect(bar).not.toHaveAttribute('aria-valuenow')
        // Soft drifting stripes on a track — not spinner-only, not empty, not fake inline %, not loud chunk marquee.
        expect(bar.querySelector('.animate-attached-job-indeterminate')).not.toBeNull()
        expect(bar.querySelector('.animate-attached-job-marquee')).toBeNull()
        expect(container.querySelector('[class*="w-1/3"]')).toBeNull()
        expect(container.querySelector('[style*="width"]')).toBeNull()
    })

    it('renders label-only unknown jobs with striped indeterminate bar + running · elapsed (shape B)', () => {
        render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary({
                        backgroundTaskCount: 0,
                        attachedJob: {
                            key: 'beets',
                            label: 'beets import',
                            status: 'running',
                            detail: 'phase: match',
                            heartbeatAt: 1_000_000,
                            startedAt: 1_000_000 - 120_000,
                            updatedAt: 1_000_000,
                        },
                        attachedJobUpdatedAt: 1,
                    })}
                />
            </I18nProvider>
        )

        expect(screen.getByText(/running · 2m/)).toBeInTheDocument()
        const bar = screen.getByTestId('attached-job-progress-bar')
        expect(bar).toHaveAttribute('data-progress', 'indeterminate')
        expect(bar.querySelector('.animate-attached-job-indeterminate')).not.toBeNull()
        expect(bar).not.toHaveAttribute('aria-valuenow')
    })

    it('renders a real fill only when total yields a fraction', () => {
        const { container } = render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary({
                        backgroundTaskCount: 0,
                        attachedJob: {
                            key: 'countdown',
                            label: 'dogfood countdown',
                            status: 'running',
                            remaining: 86_400,
                            total: 172_800,
                            unit: 's',
                            heartbeatAt: 1_000_000,
                            startedAt: 1_000_000 - 60_000,
                            updatedAt: 1_000_000,
                        },
                        attachedJobUpdatedAt: 1,
                    })}
                />
            </I18nProvider>
        )

        const bar = screen.getByTestId('attached-job-progress-bar')
        expect(bar).toHaveAttribute('data-progress', 'determinate')
        expect(bar).toHaveAttribute('aria-valuenow', '50')
        const fill = container.querySelector('[style*="width"]') as HTMLElement | null
        expect(fill).not.toBeNull()
        expect(fill!.style.width).toBe('50%')
        expect(bar.querySelector('.animate-attached-job-indeterminate')).toBeNull()
    })
})

function expectUnread() {
    expect(screen.getByText('New activity')).toHaveClass('sr-only')
    expect(screen.getByText(/demo|Background/, { selector: '[title]' })).toHaveClass('font-semibold')
}

describe('SessionRowSummary time label', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('advances the relative time without a parent render', () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ updatedAt: 1_800_000_000_000, backgroundTaskCount: 0 })} />
            </I18nProvider>
        )
        expect(screen.getByText('just now')).toBeInTheDocument()

        act(() => { vi.advanceTimersByTime(2 * 60_000) })
        expect(screen.getByText('2m ago')).toBeInTheDocument()
    })

    it('shows a Codex import marker set after the first render', () => {
        render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({
                    updatedAt: Date.now() - 3 * 60 * 60_000,
                    backgroundTaskCount: 0,
                    metadata: { path: '/demo', name: 'Imported', flavor: 'codex', agentSessionId: 'codex-thread' },
                })} />
            </I18nProvider>
        )
        expect(screen.queryByText('just imported from Codex')).toBeNull()

        act(() => { markCodexSessionsImported(['codex-thread']) })
        expect(screen.getByText('just imported from Codex')).toBeInTheDocument()
    })
})
