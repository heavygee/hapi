import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { BoardList } from './BoardList'

afterEach(() => cleanup())

function renderList(onAddBoard = vi.fn(() => Promise.resolve())) {
    return render(
        <I18nProvider>
            <BoardList
                boards={[]}
                selectedBoardId={null}
                onSelectBoard={vi.fn()}
                onAddBoard={onAddBoard}
                onRemoveBoard={vi.fn()}
                items={[]}
                statusOrder={[]}
                isLoading={false}
                error={null}
                selectedItemId={null}
                onSelectItem={vi.fn()}
                onRefresh={vi.fn()}
                isRefreshing={false}
                sessions={[]}
                onOpenSession={vi.fn()}
            />
        </I18nProvider>
    )
}

// Operator decision (hapi#238): a genuinely empty board list — no stored
// boards, no HAPI_BOARD_* env vars — must show a static explainer instead of
// the old "no items on this board" state, since there's no board id to even
// attempt a fetch for.
describe('BoardList with zero boards configured', () => {
    it('shows the no-boards explainer instead of the zero-items empty state', () => {
        renderList()

        expect(screen.getByText('No boards yet')).toBeInTheDocument()
        expect(screen.queryByText('Nothing on this board yet')).not.toBeInTheDocument()
    })

    it('offers an Add a board action that opens the add-board dialog', () => {
        renderList()

        const buttons = screen.getAllByRole('button', { name: 'Add a board' })
        fireEvent.click(buttons[buttons.length - 1]!)
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('adds the demo board directly when "Try it with an example board" is clicked', async () => {
        const onAddBoard = vi.fn(() => Promise.resolve())
        renderList(onAddBoard)

        fireEvent.click(screen.getByRole('button', { name: 'Try it with an example board' }))

        await waitFor(() => {
            expect(onAddBoard).toHaveBeenCalledWith('https://github.com/users/heavygee/projects/6')
        })
    })

    it('surfaces an error if adding the demo board fails', async () => {
        const onAddBoard = vi.fn(() => Promise.reject(new Error('boom')))
        renderList(onAddBoard)

        fireEvent.click(screen.getByRole('button', { name: 'Try it with an example board' }))

        await waitFor(() => {
            expect(screen.getByText(/boom/)).toBeInTheDocument()
        })
    })
})
