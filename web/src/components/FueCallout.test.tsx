import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FueCallout } from './Fue'

afterEach(() => {
    cleanup()
})

function Harness(props: {
    onDismiss: () => void
    onSecondaryAction?: () => void
    secondaryActionLabel?: string
}) {
    const anchorRef = useRef<HTMLButtonElement>(null)
    return (
        <>
            <button ref={anchorRef}>anchor</button>
            <FueCallout
                title="Title"
                body="Body"
                anchorRef={anchorRef}
                onDismiss={props.onDismiss}
                onSecondaryAction={props.onSecondaryAction}
                secondaryActionLabel={props.secondaryActionLabel}
            />
        </>
    )
}

describe('FueCallout', () => {
    it('renders title and body', () => {
        render(<Harness onDismiss={vi.fn()} />)
        expect(screen.getByText('Title')).toBeInTheDocument()
        expect(screen.getByText('Body')).toBeInTheDocument()
    })

    it('calls onDismiss when the primary button is clicked', () => {
        const onDismiss = vi.fn()
        render(<Harness onDismiss={onDismiss} />)
        fireEvent.click(screen.getByText('Got it'))
        expect(onDismiss).toHaveBeenCalledOnce()
    })

    it('does not render a secondary link when onSecondaryAction is omitted', () => {
        render(<Harness onDismiss={vi.fn()} />)
        expect(screen.queryByText(/don't show/i)).not.toBeInTheDocument()
    })

    it('renders and wires the secondary link when provided (e.g. global FUE disable, or "skip tour")', () => {
        const onSecondaryAction = vi.fn()
        render(
            <Harness
                onDismiss={vi.fn()}
                onSecondaryAction={onSecondaryAction}
                secondaryActionLabel="Skip tour"
            />
        )
        fireEvent.click(screen.getByText('Skip tour'))
        expect(onSecondaryAction).toHaveBeenCalledOnce()
    })
})
