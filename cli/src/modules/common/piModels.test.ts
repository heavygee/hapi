import { describe, expect, it } from 'vitest'
import { parsePiModelsFile } from './piModels'

describe('parsePiModelsFile', () => {
    it('parses local-llm catalog entries and default model', () => {
        const models = JSON.stringify({
            providers: {
                'local-llm': {
                    models: [
                        { id: 'fable-fusion', name: 'Fable-Fusion 711 (oos-llm)', contextWindow: 65536, reasoning: false },
                        { id: 'main', name: 'oos-llm alias main' },
                    ],
                },
            },
        })
        const settings = JSON.stringify({
            defaultProvider: 'local-llm',
            defaultModel: 'fable-fusion',
        })
        const result = parsePiModelsFile(models, settings)
        expect(result.success).toBe(true)
        expect(result.currentModelId).toBe('local-llm/fable-fusion')
        expect(result.availableModels).toEqual([
            {
                provider: 'local-llm',
                modelId: 'fable-fusion',
                name: 'Fable-Fusion 711 (oos-llm)',
                contextWindow: 65536,
                reasoning: false,
            },
            {
                provider: 'local-llm',
                modelId: 'main',
                name: 'oos-llm alias main',
            },
        ])
    })

    it('returns error on invalid JSON', () => {
        expect(parsePiModelsFile('{nope')).toEqual({
            success: false,
            error: 'Invalid ~/.pi/agent/models.json',
        })
    })

    it('skips models without string ids', () => {
        const models = JSON.stringify({
            providers: {
                'local-llm': {
                    models: [{ id: 123 }, { name: 'orphan' }, { id: 'ok' }],
                },
            },
        })
        const result = parsePiModelsFile(models, null)
        expect(result.success).toBe(true)
        expect(result.availableModels).toEqual([
            { provider: 'local-llm', modelId: 'ok' },
        ])
    })
})
