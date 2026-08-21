import { z } from 'zod'
import type { RpcRegistry } from '../../rpcRegistry'
import type { CliSocketWithData } from '../../socketTypes'

const rpcRegisterSchema = z.object({
    method: z.string().min(1)
})

const rpcUnregisterSchema = z.object({
    method: z.string().min(1)
})

/**
 * Scoped RPC methods are `${scopeId}:${name}` for both sessions and machines.
 * Machine scope requires create-time machine tag (#1203 / #1473 B1); session
 * scope requires namespace session access (#1473 Major).
 */
export function registerRpcHandlers(socket: CliSocketWithData, rpcRegistry: RpcRegistry): void {
    socket.on('rpc-register', (data: unknown, ack?: (response: { registered: boolean }) => void) => {
        const parsed = rpcRegisterSchema.safeParse(data)
        if (!parsed.success) {
            ack?.({ registered: false })
            return
        }
        const method = parsed.data.method
        const colon = method.indexOf(':')
        if (colon > 0) {
            const scopeId = method.slice(0, colon)
            const authorizedMachineId = typeof socket.data.machineRpcAuthorizedId === 'string'
                ? socket.data.machineRpcAuthorizedId
                : ''
            const authorizedSessionId = typeof socket.data.sessionRpcAuthorizedId === 'string'
                ? socket.data.sessionRpcAuthorizedId
                : ''
            const authorized = scopeId === authorizedMachineId || scopeId === authorizedSessionId
            if (!authorized) {
                ack?.({ registered: false })
                return
            }
        }
        const registered = rpcRegistry.register(socket, method)
        ack?.({ registered })
    })

    socket.on('rpc-unregister', (data: unknown) => {
        const parsed = rpcUnregisterSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        rpcRegistry.unregister(socket, parsed.data.method)
    })
}
