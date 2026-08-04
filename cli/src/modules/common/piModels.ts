import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ListPiModelsResponse, PiModelSummary } from '@hapi/protocol/apiTypes'
import { getErrorMessage } from './rpcResponses'

type PiModelsFile = {
    providers?: Record<string, {
        models?: Array<{
            id?: unknown
            name?: unknown
            contextWindow?: unknown
            reasoning?: unknown
        }>
    }>
}

type PiSettingsFile = {
    defaultProvider?: unknown
    defaultModel?: unknown
}

function piAgentDir(): string {
    return join(homedir(), '.pi', 'agent')
}

export function parsePiModelsFile(
    modelsRaw: string,
    settingsRaw?: string | null
): ListPiModelsResponse {
    let modelsFile: PiModelsFile
    try {
        modelsFile = JSON.parse(modelsRaw) as PiModelsFile
    } catch {
        return { success: false, error: 'Invalid ~/.pi/agent/models.json' }
    }

    const availableModels: PiModelSummary[] = []
    const providers = modelsFile.providers ?? {}
    for (const [provider, cfg] of Object.entries(providers)) {
        const models = Array.isArray(cfg?.models) ? cfg.models : []
        for (const model of models) {
            if (typeof model?.id !== 'string' || !model.id.trim()) continue
            availableModels.push({
                provider,
                modelId: model.id.trim(),
                ...(typeof model.name === 'string' && model.name.trim()
                    ? { name: model.name.trim() }
                    : {}),
                ...(typeof model.contextWindow === 'number'
                    ? { contextWindow: model.contextWindow }
                    : {}),
                ...(typeof model.reasoning === 'boolean'
                    ? { reasoning: model.reasoning }
                    : {}),
            })
        }
    }

    let currentModelId: string | null = null
    if (settingsRaw) {
        try {
            const settings = JSON.parse(settingsRaw) as PiSettingsFile
            const provider = typeof settings.defaultProvider === 'string'
                ? settings.defaultProvider.trim()
                : ''
            const modelId = typeof settings.defaultModel === 'string'
                ? settings.defaultModel.trim()
                : ''
            if (provider && modelId) {
                currentModelId = `${provider}/${modelId}`
            } else if (modelId) {
                currentModelId = modelId
            }
        } catch {
            // ignore settings parse errors; catalog still useful
        }
    }

    return {
        success: true,
        availableModels,
        currentModelId,
    }
}

/** Machine-scoped Pi catalog from ~/.pi/agent/{models,settings}.json (New Session picker). */
export async function listPiModelsFromConfig(): Promise<ListPiModelsResponse> {
    const dir = piAgentDir()
    try {
        const modelsRaw = await readFile(join(dir, 'models.json'), 'utf8')
        let settingsRaw: string | null = null
        try {
            settingsRaw = await readFile(join(dir, 'settings.json'), 'utf8')
        } catch {
            settingsRaw = null
        }
        return parsePiModelsFile(modelsRaw, settingsRaw)
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error, 'Failed to read ~/.pi/agent/models.json'),
        }
    }
}

export type { ListPiModelsResponse }
