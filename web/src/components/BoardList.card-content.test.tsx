import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { BoardList } from './BoardList'

afterEach(() => cleanup())

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
    return {
        id: 'item-1',
        title: 'Fix the thing',
        url: 'https://github.com/acme/widgets/issues/1',
        number: 1,
        repo: 'acme/widgets',
        state: 'OPEN',
        status: 'Todo',
        updatedAt: null,
        body: null,
        isPullRequest: false,
        createdAt: null,
        closedAt: null,
        author: null,
        assignees: [],
        labels: [],
        milestone: null,
        customFields: [],
        ...overrides
    }
}

function renderList(items: BoardItem[], overrides: { onRefresh?: () => void; isRefreshing?: boolean } = {}) {
    return render(
        <I18nProvider>
            <BoardList
                boards={[{ id: 'board-1', label: 'heavygee/6' }]}
                selectedBoardId="board-1"
                onSelectBoard={vi.fn()}
                onAddBoard={vi.fn()}
                onRemoveBoard={vi.fn()}
                items={items}
                statusOrder={['Todo']}
                doneValues={['Done']}
                isLoading={false}
                error={null}
                selectedItemId={null}
                onSelectItem={vi.fn()}
                onRefresh={overrides.onRefresh ?? vi.fn()}
                isRefreshing={overrides.isRefreshing ?? false}
            />
        </I18nProvider>
    )
}

// Operator feedback (hapi#238): "the whole reason to bring these cards here
// is to not have to go to GitHub" — cards must show assignees and labels at
// a glance, not just title/repo/number.
describe('BoardList card content', () => {
    it('shows label chips on a card', () => {
        renderList([makeItem({ labels: [{ name: 'bug', color: 'ff0000' }, { name: 'urgent', color: '00ff00' }] })])
        expect(screen.getByText('bug')).toBeInTheDocument()
        expect(screen.getByText('urgent')).toBeInTheDocument()
    })

    it('shows assignee avatars, capped with a +N overflow indicator', () => {
        renderList([makeItem({
            assignees: [
                { login: 'a', avatarUrl: 'https://example.com/a.png' },
                { login: 'b', avatarUrl: 'https://example.com/b.png' },
                { login: 'c', avatarUrl: 'https://example.com/c.png' },
                { login: 'd', avatarUrl: 'https://example.com/d.png' },
                { login: 'e', avatarUrl: 'https://example.com/e.png' }
            ]
        })])
        expect(screen.getByTitle('a')).toBeInTheDocument()
        expect(screen.getByTitle('d')).toBeInTheDocument()
        expect(screen.queryByTitle('e')).not.toBeInTheDocument()
        expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('renders no label/assignee row when the item has neither', () => {
        renderList([makeItem()])
        expect(screen.queryByText('bug')).not.toBeInTheDocument()
    })

    it('calls onRefresh from the list-view refresh button', () => {
        const onRefresh = vi.fn()
        renderList([makeItem()], { onRefresh })
        screen.getByRole('button', { name: 'Refresh' }).click()
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })
})
