import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { PiModelSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function usePiModelsForMachine(args: {
    api: ApiClient | null
    machineId?: string | null
    enabled?: boolean
}): {
    availableModels: PiModelSummary[]
    currentModelId: string | null
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const { api, machineId } = args
    const enabled = Boolean(args.enabled && api && machineId)

    const query = useQuery({
        queryKey: machineId
            ? queryKeys.machinePiModels(machineId)
            : ['machine-pi-models', 'unknown'] as const,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!machineId) {
                throw new Error('Pi models target unavailable')
            }
            return await api.getMachinePiModels(machineId)
        },
        enabled,
        staleTime: 60_000,
        retry: false,
    })

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModelId: query.data?.currentModelId ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load Pi models')
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load Pi models'
                    : null,
        refetch: () => {
            void query.refetch()
        },
    }
}

/** Build New Session select options from machine Pi catalog. */
export function buildPiNewSessionModelOptions(
    models: PiModelSummary[],
    currentModelId?: string | null
): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [
        { value: 'auto', label: 'Default (Pi settings)' },
    ]
    const seen = new Set<string>(['auto'])
    for (const model of models) {
        const value = `${model.provider}/${model.modelId}`
        if (seen.has(value)) continue
        seen.add(value)
        options.push({
            value,
            label: model.name?.trim() || value,
        })
    }
    if (currentModelId && !seen.has(currentModelId)) {
        options.splice(1, 0, { value: currentModelId, label: currentModelId })
    }
    return options
}
