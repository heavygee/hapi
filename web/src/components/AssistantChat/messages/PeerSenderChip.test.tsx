import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PeerSenderChip } from './PeerSenderChip'

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

vi.mock('@/components/AssistantChat/context', () => ({
    useOptionalHappyChatContext: () => null,
}))

const sessionsState = vi.hoisted(() => ({
    sessions: [] as Array<{ id: string; metadata?: { name?: string } }>,
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        sessions: sessionsState.sessions,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
    }),
}))

describe('PeerSenderChip', () => {
    it('renders the same @title chip label as rich-composer mentions', () => {
        sessionsState.sessions = []
        render(
            <PeerSenderChip
                sourceSessionId="3e387783-d48e-4a73-932a-90acebe91702"
                sourceName="hapi-inline ownership"
            />
        )
        const chip = screen.getByRole('button', { name: /hapi-inline ownership/i })
        expect(chip).toHaveTextContent('@hapi-inline ownership')
        expect(chip).toHaveAttribute('data-session-id', '3e387783-d48e-4a73-932a-90acebe91702')
        expect(chip).toHaveAttribute('data-hapi-peer-delivery', 'true')
        expect(chip).not.toHaveAttribute('data-hapi-peer-unverified')
    })

    it('renders claimed identity with ⚠ when hub did not verify', () => {
        sessionsState.sessions = [
            {
                id: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
                metadata: { name: 'Listed peer' },
            },
        ]
        render(
            <PeerSenderChip
                claimedSessionId="6212dae5-8a60-4284-b7a5-c09aa3571ce4"
                claimedName="Meta tooling"
            />
        )
        const chip = screen.getByRole('button', { name: /Meta tooling/i })
        expect(chip).toHaveTextContent('@Meta tooling')
        expect(chip).toHaveTextContent('⚠')
        expect(chip).toHaveAttribute('data-hapi-peer-unverified', 'true')
        expect(chip.getAttribute('title')).toContain('message.peerUnverifiedTooltip')
    })

    it('renders a non-link @peer⚠ chip when source is unknown', () => {
        sessionsState.sessions = []
        render(<PeerSenderChip />)
        const chip = screen.getByLabelText('message.peerUnverifiedTooltip')
        expect(chip).toHaveAttribute('data-hapi-peer-unknown', 'true')
        expect(chip).toHaveAttribute('data-hapi-peer-unverified', 'true')
        expect(chip).toHaveTextContent('message.peerUnknownChip')
        expect(chip).toHaveTextContent('⚠')
    })
})
