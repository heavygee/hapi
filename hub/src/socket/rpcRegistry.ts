import type { Socket } from 'socket.io'

/**
 * Maps RPC method names → owning socket.
 *
 * Last-writer-wins would let a second same-namespace machine socket steal
 * `spawn-happy-session`. Refuse overwrite while another socket still owns the
 * method (#1203 pass 2e-alt M4).
 */
export class RpcRegistry {
    private readonly methodToSocketId: Map<string, string> = new Map()
    private readonly socketIdToMethods: Map<string, Set<string>> = new Map()

    register(socket: Socket, method: string): boolean {
        if (!method) {
            return false
        }

        const existing = this.methodToSocketId.get(method)
        if (existing && existing !== socket.id) {
            return false
        }

        this.methodToSocketId.set(method, socket.id)

        const owned = this.socketIdToMethods.get(socket.id)
        if (owned) {
            owned.add(method)
        } else {
            this.socketIdToMethods.set(socket.id, new Set([method]))
        }
        return true
    }

    unregister(socket: Socket, method: string): void {
        const socketId = this.methodToSocketId.get(method)
        if (socketId === socket.id) {
            this.methodToSocketId.delete(method)
        }

        const methods = this.socketIdToMethods.get(socket.id)
        if (methods) {
            methods.delete(method)
            if (methods.size === 0) {
                this.socketIdToMethods.delete(socket.id)
            }
        }
    }

    unregisterAll(socket: Socket): void {
        const methods = this.socketIdToMethods.get(socket.id)
        if (!methods) {
            return
        }
        for (const method of methods) {
            const socketId = this.methodToSocketId.get(method)
            if (socketId === socket.id) {
                this.methodToSocketId.delete(method)
            }
        }
        this.socketIdToMethods.delete(socket.id)
    }

    getSocketIdForMethod(method: string): string | null {
        return this.methodToSocketId.get(method) ?? null
    }
}
