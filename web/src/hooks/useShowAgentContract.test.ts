import { afterEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_SHOW_AGENT_CONTRACT,
    SHOW_AGENT_CONTRACT_STORAGE_KEY,
    getInitialShowAgentContract
} from './useShowAgentContract'

describe('getInitialShowAgentContract', () => {
    afterEach(() => {
        localStorage.removeItem(SHOW_AGENT_CONTRACT_STORAGE_KEY)
    })

    it('defaults to strip (false)', () => {
        expect(getInitialShowAgentContract()).toBe(DEFAULT_SHOW_AGENT_CONTRACT)
        expect(getInitialShowAgentContract()).toBe(false)
    })

    it('reads true from localStorage', () => {
        localStorage.setItem(SHOW_AGENT_CONTRACT_STORAGE_KEY, 'true')
        expect(getInitialShowAgentContract()).toBe(true)
    })

    it('treats any other value as false', () => {
        localStorage.setItem(SHOW_AGENT_CONTRACT_STORAGE_KEY, '1')
        expect(getInitialShowAgentContract()).toBe(false)
    })
})
