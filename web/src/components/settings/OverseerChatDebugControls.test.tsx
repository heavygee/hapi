import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OverseerChatDebugControls } from './OverseerChatDebugControls'

const {
    fetchOverseerConverseRecent,
    overseerConverse,
    fetchOverseerBrains,
    fetchOverseerBrainModels,
    mockApi
} = vi.hoisted(() => {
    const fetchOverseerConverseRecent = vi.fn()
    const overseerConverse = vi.fn()
    const fetchOverseerBrains = vi.fn()
    const fetchOverseerBrainModels = vi.fn()
    const mockApi = {
        fetchOverseerConverseRecent,
        overseerConverse,
        fetchOverseerBrains,
        fetchOverseerBrainModels
    }
    return {
        fetchOverseerConverseRecent,
        overseerConverse,
        fetchOverseerBrains,
        fetchOverseerBrainModels,
        mockApi
    }
})

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: mockApi })
}))

describe('OverseerChatDebugControls', () => {
    beforeEach(() => {
        HTMLElement.prototype.scrollTo = vi.fn()
        fetchOverseerConverseRecent.mockReset()
        overseerConverse.mockReset()
        fetchOverseerBrains.mockReset()
        fetchOverseerBrainModels.mockReset()
        fetchOverseerConverseRecent.mockResolvedValue({ turns: [] })
        fetchOverseerBrains.mockResolvedValue({ profiles: [] })
        fetchOverseerBrainModels.mockResolvedValue({ models: [] })
    })

    it('preserves in-flight operator turn when panel reopens during converse', async () => {
        let resolveConverse: (value: unknown) => void = () => {}
        const conversePromise = new Promise((resolve) => { resolveConverse = resolve })
        overseerConverse.mockReturnValue(conversePromise)

        render(<OverseerChatDebugControls />)
        const toggle = screen.getByRole('button', { name: /Talk to the Overseer/ })
        fireEvent.click(toggle)
        await waitFor(() => expect(fetchOverseerConverseRecent).toHaveBeenCalled())
        await waitFor(() => {
            expect(screen.queryByText('Loading hub thread…')).toBeNull()
        }, { timeout: 3000 })
        const hydrateCallsBeforeSend = fetchOverseerConverseRecent.mock.calls.length

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: 'hello fleet' } })
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))

        expect(screen.getByText('hello fleet')).toBeTruthy()

        fireEvent.click(toggle)
        fireEvent.click(toggle)

        // Hydrate is skipped while converse is in flight — hub fetch must not wipe local turns.
        expect(fetchOverseerConverseRecent.mock.calls.length).toBe(hydrateCallsBeforeSend)
        expect(screen.getByText('hello fleet')).toBeTruthy()

        resolveConverse({
            reply: 'on it',
            toolTrace: [],
            model: 'main',
            brainOnline: true
        })
        await waitFor(() => expect(screen.getByText('on it')).toBeTruthy())
        await waitFor(() => expect(fetchOverseerConverseRecent.mock.calls.length).toBeGreaterThan(hydrateCallsBeforeSend))
    })
})
