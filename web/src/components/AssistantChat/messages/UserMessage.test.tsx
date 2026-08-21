import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
    HappyUserMessage,
    selectIsPeerDelivery,
    selectPeerSourceId,
    selectPeerSourceName,
} from './UserMessage'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'

const peerCustom: Partial<HappyChatMessageMetadata> = {
    kind: 'user',
    sentFrom: 'peer',
    peer: {
        sourceSessionId: '6212dae5-8a60-4284-b7a5-c09aa3571ce4',
        sourceName: 'Orchestrator',
    },
}

let auiState = {
    message: {
        role: 'user' as const,
        id: 'msg-peer-1',
        content: [{ type: 'text' as const, text: 'handoff body' }],
        metadata: { custom: peerCustom },
    },
}

vi.mock('@assistant-ui/react', () => ({
    useAuiState: (selector: (state: typeof auiState) => unknown) => selector(auiState),
    MessagePrimitive: {
        Root: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
            <div data-testid="message-root" {...props}>{children}</div>
        ),
    },
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({ sessions: [], isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/components/AssistantChat/context', () => ({
    useHappyChatContext: () => ({
        api: {},
        sessionId: 'target-session',
        metadata: null,
        terminalToolDisplayMode: 'compact',
        disabled: false,
        onRefresh: vi.fn(),
        hasMoreMessages: false,
        isSyncingTail: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => 'terminal-stop' as const,
    }),
    useOptionalHappyChatContext: () => null,
}))

vi.mock('@/components/AssistantChat/messages/MessageActions', () => ({
    MessageActions: () => null,
}))

vi.mock('@/components/AssistantChat/messages/user-bubble', () => ({
    UserBubbleContent: ({ text }: { text: string }) => <div>{text}</div>,
    getUserBubbleClassName: () => 'bubble',
    shouldShowMessageStatus: () => false,
}))

describe('HappyUserMessage peer selectors', () => {
    it('returns Object.is-stable primitives so useSyncExternalStore cannot loop', () => {
        const snapshot = {
            message: {
                role: 'user',
                metadata: { custom: peerCustom },
            },
        }
        expect(Object.is(selectIsPeerDelivery(snapshot), selectIsPeerDelivery(snapshot))).toBe(true)
        expect(Object.is(selectPeerSourceId(snapshot), selectPeerSourceId(snapshot))).toBe(true)
        expect(Object.is(selectPeerSourceName(snapshot), selectPeerSourceName(snapshot))).toBe(true)
        expect(selectIsPeerDelivery(snapshot)).toBe(true)
        expect(selectPeerSourceId(snapshot)).toBe('6212dae5-8a60-4284-b7a5-c09aa3571ce4')
        expect(selectPeerSourceName(snapshot)).toBe('Orchestrator')
    })

    it('renders PeerSenderChip for an attributed peer user row', () => {
        auiState = {
            message: {
                role: 'user',
                id: 'msg-peer-1',
                content: [{ type: 'text', text: 'handoff body' }],
                metadata: { custom: peerCustom },
            },
        }
        render(<HappyUserMessage />)
        const chip = screen.getByRole('button', { name: /Orchestrator/i })
        expect(chip).toHaveAttribute('data-hapi-peer-delivery', 'true')
        expect(chip).toHaveAttribute('data-session-id', '6212dae5-8a60-4284-b7a5-c09aa3571ce4')
        expect(screen.getByText('handoff body')).toBeTruthy()
    })
})
