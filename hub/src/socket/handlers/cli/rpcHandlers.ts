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
 * Machine-scoped RPC methods are `${machineId}:${name}`. Only sockets that
 * proved the create-time machine tag may own those methods (#1203 / #1473 B1).
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
            const methodMachineId = method.slice(0, colon)
            const authorizedMachineId = typeof socket.data.machineRpcAuthorizedId === 'string'
                ? socket.data.machineRpcAuthorizedId
                : ''
            if (!authorizedMachineId || authorizedMachineId !== methodMachineId) {
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
