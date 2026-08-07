import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OverseerChatDebugControls } from './OverseerChatDebugControls'

const {
    overseerConverse,
    fetchOverseerBrains,
    fetchOverseerBrainModels,
    mockApi
} = vi.hoisted(() => {
    const overseerConverse = vi.fn()
    const fetchOverseerBrains = vi.fn()
    const fetchOverseerBrainModels = vi.fn()
    const mockApi = {
        overseerConverse,
        fetchOverseerBrains,
        fetchOverseerBrainModels
    }
    return {
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
        overseerConverse.mockReset()
        fetchOverseerBrains.mockReset()
        fetchOverseerBrainModels.mockReset()
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

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: 'hello fleet' } })
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))

        expect(screen.getByText('hello fleet')).toBeTruthy()

        // Collapse + reopen while converse is in flight — local turns must survive.
        fireEvent.click(toggle)
        fireEvent.click(toggle)

        expect(screen.getByText('hello fleet')).toBeTruthy()

        resolveConverse({
            reply: 'on it',
            toolTrace: [],
            model: 'main',
            brainOnline: true
        })
        await waitFor(() => expect(screen.getByText('on it')).toBeTruthy())
    })
})
