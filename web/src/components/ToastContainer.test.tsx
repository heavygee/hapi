import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastContainer } from './ToastContainer'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { consumeExplicitSessionNavigationIntent } from '@/lib/explicitSessionNavigationIntent'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock,
}))

function AddToastOnMount({ sessionId }: { sessionId: string }) {
    const { addToast } = useToast()
    useEffect(() => {
        addToast({ title: 'Session update', body: 'something happened', sessionId, url: '' })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
}

describe('ToastContainer', () => {
    it('marks explicit session navigation intent before navigating on click', async () => {
        consumeExplicitSessionNavigationIntent() // drain any stale flag from a prior test

        render(
            <ToastProvider>
                <AddToastOnMount sessionId="session-123" />
                <ToastContainer />
            </ToastProvider>
        )

        const toast = await screen.findByText('Session update')
        fireEvent.click(toast)

        expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
            to: '/sessions/$sessionId',
            params: { sessionId: 'session-123' },
        }))
        // The flag must already be set by the time navigate() is called —
        // consuming it now (post-click) should still see true.
        expect(consumeExplicitSessionNavigationIntent()).toBe(true)
    })
})
