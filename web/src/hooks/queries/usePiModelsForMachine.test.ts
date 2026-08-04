import { describe, expect, it } from 'vitest'
import { buildPiNewSessionModelOptions } from './usePiModelsForMachine'

describe('buildPiNewSessionModelOptions', () => {
    it('prefixes provider/modelId and prefers friendly names', () => {
        expect(buildPiNewSessionModelOptions(
            [
                { provider: 'local-llm', modelId: 'fable-fusion', name: 'Fable-Fusion 711 (oos-llm)' },
                { provider: 'local-llm', modelId: 'main' },
            ],
            'local-llm/fable-fusion',
        )).toEqual([
            { value: 'auto', label: 'Default (Pi settings)' },
            { value: 'local-llm/fable-fusion', label: 'Fable-Fusion 711 (oos-llm)' },
            { value: 'local-llm/main', label: 'local-llm/main' },
        ])
    })

    it('injects currentModelId when missing from catalog', () => {
        const options = buildPiNewSessionModelOptions([], 'local-llm/fable-fusion')
        expect(options).toEqual([
            { value: 'auto', label: 'Default (Pi settings)' },
            { value: 'local-llm/fable-fusion', label: 'local-llm/fable-fusion' },
        ])
    })
})
