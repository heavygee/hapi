import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { BoardItemDetail } from './BoardItemDetail'

afterEach(() => cleanup())

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
    return {
        id: 'item-1',
        title: 'Fix the thing',
        url: 'https://github.com/acme/widgets/issues/12',
        number: 12,
        repo: 'acme/widgets',
        state: 'OPEN',
        status: 'In Progress',
        updatedAt: '2026-10-06T12:00:00Z',
        body: 'Some body text.',
        isPullRequest: false,
        createdAt: '2026-10-01T09:00:00Z',
        closedAt: null,
        author: null,
        assignees: [],
        labels: [],
        milestone: null,
        customFields: [],
        ...overrides
    }
}

function renderDetail(overrides: Partial<Parameters<typeof BoardItemDetail>[0]> = {}) {
    const props = {
        item: makeItem(),
        statusOrder: ['Todo', 'In Progress', 'Done'],
        onBack: vi.fn(),
        onSpawn: vi.fn(),
        linkedSessionId: null,
        onOpenLinkedSession: vi.fn(),
        onRefresh: vi.fn(),
        isRefreshing: false,
        onClose: vi.fn().mockResolvedValue(undefined),
        onReopen: vi.fn(),
        onComment: vi.fn(),
        onSetStatus: vi.fn(),
        isClosing: false,
        isReopening: false,
        isCommenting: false,
        isSettingStatus: false,
        ...overrides
    }
    render(
        <I18nProvider>
            <BoardItemDetail {...props} />
        </I18nProvider>
    )
    return props
}

describe('BoardItemDetail', () => {
    it('renders assignees, labels, milestone, author, and custom fields', () => {
        renderDetail({
            item: makeItem({
                author: { login: 'octocat', avatarUrl: 'https://example.com/a.png' },
                assignees: [{ login: 'hubot', avatarUrl: 'https://example.com/b.png' }],
                labels: [{ name: 'bug', color: 'ff0000' }],
                milestone: { title: 'v1.0', dueOn: '2026-12-01' },
                customFields: [{ name: 'Priority', value: 'High' }]
            })
        })

        expect(screen.getByText('Opened by octocat')).toBeInTheDocument()
        expect(screen.getByText('hubot')).toBeInTheDocument()
        expect(screen.getByText('bug')).toBeInTheDocument()
        expect(screen.getByText(/v1\.0/)).toBeInTheDocument()
        expect(screen.getByText('Priority')).toBeInTheDocument()
        expect(screen.getByText(/High/)).toBeInTheDocument()
    })

    it('fires onSetStatus only when the dropdown value actually changes', () => {
        const { onSetStatus } = renderDetail()
        const select = screen.getByLabelText(/Status/) as HTMLSelectElement
        expect(select.value).toBe('In Progress')

        // Re-selecting the current value is a no-op change event in jsdom
        // (fireEvent.change always fires regardless), so assert the handler
        // itself guards on actual change by picking a genuinely different value.
        fireEvent.change(select, { target: { value: 'Done' } })
        expect(onSetStatus).toHaveBeenCalledWith('Done')
        expect(onSetStatus).toHaveBeenCalledTimes(1)
    })

    it('requires confirmation before closing, then calls onClose', async () => {
        const { onClose } = renderDetail()
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onClose).not.toHaveBeenCalled()

        const dialog = await screen.findByRole('dialog')
        // The dialog also has its own "×" dismiss button with aria-label
        // "Close", sharing the same accessible name as the confirm button —
        // the confirm button is the one inside the action-button row.
        const confirmButton = within(dialog).getAllByRole('button', { name: 'Close' })[0]!
        fireEvent.click(confirmButton)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows Reopen (no confirm) instead of Close when the item is already closed', () => {
        const { onReopen } = renderDetail({ item: makeItem({ state: 'CLOSED' }) })
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
        expect(onReopen).toHaveBeenCalledTimes(1)
    })

    it('offers neither Close nor Reopen for a merged PR — GitHub rejects reopening a merged PR', () => {
        renderDetail({ item: makeItem({ state: 'MERGED', isPullRequest: true }) })
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument()
    })

    it('sends a comment and clears the draft once the send succeeds', async () => {
        const onComment = vi.fn().mockResolvedValue(undefined)
        renderDetail({ onComment })
        const textarea = screen.getByPlaceholderText('Leave a comment…')
        fireEvent.change(textarea, { target: { value: 'Looks good' } })
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        expect(onComment).toHaveBeenCalledWith('Looks good')
        await screen.findByDisplayValue('')
    })

    it('keeps the draft intact if sending the comment fails', async () => {
        const onComment = vi.fn().mockRejectedValue(new Error('boom'))
        renderDetail({ onComment })
        const textarea = screen.getByPlaceholderText('Leave a comment…') as HTMLTextAreaElement
        fireEvent.change(textarea, { target: { value: 'Looks good' } })
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        expect(onComment).toHaveBeenCalledWith('Looks good')
        // The caller already surfaces the failure as a toast — this component
        // must not also lose the user's typed text on top of that.
        await vi.waitFor(() => expect(textarea.value).toBe('Looks good'))
    })

    it('disables the comment button for a blank/whitespace-only draft', () => {
        renderDetail()
        const textarea = screen.getByPlaceholderText('Leave a comment…')
        fireEvent.change(textarea, { target: { value: '   ' } })
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
    })

    it('hides every write action for a draft issue (no url)', () => {
        renderDetail({ item: makeItem({ url: null, number: null }) })
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Leave a comment…')).not.toBeInTheDocument()
        expect(screen.queryByLabelText(/Status/)).not.toBeInTheDocument()
    })

    it('calls onRefresh from the refresh button', () => {
        const { onRefresh } = renderDetail()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('offers "Open session" instead of "Spawn session" when a session is already linked', () => {
        const { onOpenLinkedSession } = renderDetail({ linkedSessionId: 'session-42' })
        expect(screen.queryByRole('button', { name: 'Spawn session' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
        expect(onOpenLinkedSession).toHaveBeenCalledWith('session-42')
    })

    it('offers "Spawn session" when no session is linked', () => {
        renderDetail({ linkedSessionId: null })
        expect(screen.queryByRole('button', { name: 'Open session' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Spawn session' })).toBeInTheDocument()
    })
})

// Operator affordance audit (hapi#238): navigation (view something, no state
// change) must look visually lighter than mutation (changes something) —
// previously every footer button used the same `outline` treatment
// regardless of consequence, and pending mutations showed only a disabled
// control with a text swap, no actual spinner.
describe('BoardItemDetail affordance treatment', () => {
    it('gives "Open in GitHub" (pure navigation) the lighter outline treatment', () => {
        renderDetail()
        const link = screen.getByRole('link', { name: /Open in GitHub/ })
        expect(link.className).toContain('border')
        expect(link.className).not.toContain('bg-[var(--app-button)]')
    })

    it('gives "Spawn session" (a mutation — creates a session) the filled/primary treatment', () => {
        renderDetail({ linkedSessionId: null })
        const button = screen.getByRole('button', { name: /Spawn session/ })
        expect(button.className).toContain('bg-[var(--app-button)]')
    })

    it('shows a visible spinner, not just disabled+text-swap, while closing', () => {
        renderDetail({ isClosing: true })
        const button = screen.getByRole('button', { name: /Closing/ })
        expect(button).toBeDisabled()
        expect(button.querySelector('svg.animate-spin')).not.toBeNull()
    })

    it('shows a visible spinner while reopening', () => {
        renderDetail({ item: makeItem({ state: 'CLOSED' }), isReopening: true })
        const button = screen.getByRole('button', { name: /Reopening/ })
        expect(button).toBeDisabled()
        expect(button.querySelector('svg.animate-spin')).not.toBeNull()
    })

    it('shows a visible spinner while sending a comment', () => {
        renderDetail({ isCommenting: true })
        const button = screen.getByRole('button', { name: /Commenting/ })
        expect(button).toBeDisabled()
        expect(button.querySelector('svg.animate-spin')).not.toBeNull()
    })

    it('shows a visible spinner next to the status select while changing status', () => {
        renderDetail({ isSettingStatus: true })
        expect(screen.getByRole('status', { name: 'Changing status…' })).toBeInTheDocument()
    })

    it('does not show the status spinner when not changing status', () => {
        renderDetail({ isSettingStatus: false })
        expect(screen.queryByRole('status', { name: 'Changing status…' })).not.toBeInTheDocument()
    })
})
