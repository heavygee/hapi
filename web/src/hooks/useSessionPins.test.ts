import { describe, expect, it } from 'vitest'
import { hubMessageIdFromThreadMessageId } from '@/hooks/useSessionPins'

describe('hubMessageIdFromThreadMessageId', () => {
    it('extracts hub UUIDs from assistant-ui thread ids', () => {
        expect(hubMessageIdFromThreadMessageId('agent-text:abc-123:0')).toBe('abc-123')
        expect(hubMessageIdFromThreadMessageId('user-text:abc-123')).toBe('abc-123')
        expect(hubMessageIdFromThreadMessageId('agent-text:abc-123~1')).toBe('abc-123')
        expect(hubMessageIdFromThreadMessageId('not-a-thread-id')).toBeNull()
    })
})
