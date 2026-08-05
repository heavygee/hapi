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

    it('does not render a secondary checkbox when onSecondaryAction is omitted', () => {
        render(<Harness onDismiss={vi.fn()} />)
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('checking the secondary box is inert on its own — no callback fires until confirmed', () => {
        const onSecondaryAction = vi.fn()
        const onDismiss = vi.fn()
        render(
            <Harness
                onDismiss={onDismiss}
                onSecondaryAction={onSecondaryAction}
                secondaryActionLabel="Skip tour"
            />
        )
        fireEvent.click(screen.getByRole('checkbox', { name: 'Skip tour' }))
        expect(onSecondaryAction).not.toHaveBeenCalled()
        expect(onDismiss).not.toHaveBeenCalled()
    })

    it('fires onSecondaryAction before onDismiss when the box is checked and the primary button is clicked', () => {
        const onSecondaryAction = vi.fn()
        const onDismiss = vi.fn()
        render(
            <Harness
                onDismiss={onDismiss}
                onSecondaryAction={onSecondaryAction}
                secondaryActionLabel="Skip tour"
            />
        )
        fireEvent.click(screen.getByRole('checkbox', { name: 'Skip tour' }))
        fireEvent.click(screen.getByText('Got it'))
        expect(onSecondaryAction).toHaveBeenCalledOnce()
        expect(onDismiss).toHaveBeenCalledOnce()
    })

    it('does not fire onSecondaryAction when the box is left unchecked', () => {
        const onSecondaryAction = vi.fn()
        const onDismiss = vi.fn()
        render(
            <Harness
                onDismiss={onDismiss}
                onSecondaryAction={onSecondaryAction}
                secondaryActionLabel="Skip tour"
            />
        )
        fireEvent.click(screen.getByText('Got it'))
        expect(onSecondaryAction).not.toHaveBeenCalled()
        expect(onDismiss).toHaveBeenCalledOnce()
    })
})
