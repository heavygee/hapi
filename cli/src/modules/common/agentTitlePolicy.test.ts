import { afterEach, describe, expect, it } from 'vitest'
import {
    applyHubAgentTitlePolicy,
    buildAgentTitleSteer,
    getAgentTitlePolicy,
    isNameOnceAgentTitlePolicy,
    resetAgentTitlePolicyForTests
} from './agentTitlePolicy'

afterEach(() => {
    resetAgentTitlePolicyForTests()
    delete process.env.HAPI_AGENT_TITLE_POLICY
})

describe('agentTitlePolicy', () => {
    it('defaults to allow_rename', () => {
        expect(getAgentTitlePolicy({})).toBe('allow_rename')
        expect(isNameOnceAgentTitlePolicy({})).toBe(false)
    })

    it('applies hub bootstrap preference', () => {
        applyHubAgentTitlePolicy('name_once')
        expect(getAgentTitlePolicy({})).toBe('name_once')
        expect(buildAgentTitleSteer('change_title', {})).toContain('already has a title')
    })

    it('lets env override hub', () => {
        applyHubAgentTitlePolicy('allow_rename')
        expect(getAgentTitlePolicy({ HAPI_AGENT_TITLE_POLICY: 'name_once' })).toBe('name_once')
    })

    it('keeps allow_rename steer mentioning objective changes', () => {
        expect(buildAgentTitleSteer('mcp__hapi__change_title', {})).toContain('primary objective changes')
    })
})
