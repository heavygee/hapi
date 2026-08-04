import { logger } from '@/ui/logger'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import {
    listPiModelsFromConfig,
    type ListPiModelsResponse
} from '../piModels'
import { getErrorMessage, rpcError } from '../rpcResponses'

export function registerPiModelHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, ListPiModelsResponse>(
        RPC_METHODS.ListPiModels,
        async () => {
            logger.debug('List Pi models (machine catalog) request')
            try {
                return await listPiModelsFromConfig()
            } catch (error) {
                logger.debug('Failed to list Pi models:', error)
                return rpcError(getErrorMessage(error, 'Failed to list Pi models'))
            }
        }
    )
}
