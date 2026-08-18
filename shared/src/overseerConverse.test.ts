import { describe, expect, it } from 'vitest'
import {
    buildOverseerOpenAiTools,
    hasOpenAiForbiddenToolParamRoot,
    OPENAI_FORBIDDEN_TOOL_PARAM_ROOT_KEYS
} from './overseerConverse'

describe('buildOverseerOpenAiTools OpenAI compatibility', () => {
    it('never puts anyOf/oneOf/allOf/enum/const/not at the root of function.parameters', () => {
        const tools = buildOverseerOpenAiTools()
        expect(tools.length).toBeGreaterThan(0)
        for (const tool of tools) {
            const params = tool.function.parameters
            expect(params.type).toBe('object')
            for (const key of OPENAI_FORBIDDEN_TOOL_PARAM_ROOT_KEYS) {
                expect(params, `${tool.function.name} must not have top-level ${key}`).not.toHaveProperty(key)
            }
            expect(hasOpenAiForbiddenToolParamRoot(params)).toBe(false)
        }
    })

    it('keeps ping_session as a plain object with required message only', () => {
        const ping = buildOverseerOpenAiTools().find((t) => t.function.name === 'ping_session')
        expect(ping).toBeDefined()
        const params = ping!.function.parameters
        expect(params.type).toBe('object')
        expect(params.required).toEqual(['message'])
        expect(params).not.toHaveProperty('anyOf')
        expect(params.properties).toMatchObject({
            sessionId: expect.objectContaining({ type: 'string' }),
            itemId: expect.objectContaining({ type: 'integer' }),
            message: expect.objectContaining({ type: 'string' })
        })
    })
})
