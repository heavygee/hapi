import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VoiceFocusPill } from './VoiceFocusPill'

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} }),
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        sessions: [{ id: 'sess-a', metadata: { name: 'Alpha' }, active: true, thinking: false, activeAt: 0, updatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [], backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null }],
    }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string>) => {
            if (key === 'voice.focus.pill') return `voice → ${params?.target ?? ''}`
            if (key === 'voice.focus.goToSession') return 'Go'
            if (key === 'voice.end') return 'End'
            return key
        },
    }),
}))

const voiceState = {
    status: 'connected' as 'connected' | 'disconnected' | 'connecting' | 'error',
    voiceFocus: { kind: 'session' as const, ref: 'sess-a' },
    stopVoice: vi.fn(),
}

vi.mock('@/lib/voice-context', () => ({
    useVoice: () => voiceState,
}))

describe('VoiceFocusPill', () => {
    it('renders persistent chrome pill for active session voice', () => {
        render(<VoiceFocusPill />)
        expect(screen.getByTestId('voice-focus-pill')).toHaveTextContent('voice → Alpha')
    })

    it('hides when voice is disconnected', () => {
        voiceState.status = 'disconnected'
        const { container } = render(<VoiceFocusPill />)
        expect(container).toBeEmptyDOMElement()
        voiceState.status = 'connected'
    })
})
