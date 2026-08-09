/**
 * Generic RPC handler manager for session and machine clients
 * Manages RPC method registration and handler execution (no encryption).
 */

import { logger as defaultLogger } from '@/ui/logger'
import type { RpcHandler, RpcHandlerConfig, RpcHandlerMap, RpcRequest } from './types'
import type { Socket } from 'socket.io-client'

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

export class RpcHandlerManager {
    private handlers: RpcHandlerMap = new Map()
    private readonly scopePrefix: string
    private readonly logger: (message: string, data?: any) => void
    private socket: Socket | null = null
    private registerRetryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    constructor(config: RpcHandlerConfig) {
        this.scopePrefix = config.scopePrefix
        this.logger = config.logger || ((msg, data) => defaultLogger.debug(msg, data))
    }

    registerHandler<TRequest = any, TResponse = any>(
        method: string,
        handler: RpcHandler<TRequest, TResponse>
    ): void {
        const prefixedMethod = this.getPrefixedMethod(method)

        this.handlers.set(prefixedMethod, handler)

        if (this.socket) {
            this.emitRegister(prefixedMethod)
        }
    }

    async handleRequest(request: RpcRequest): Promise<string> {
        try {
            const handler = this.handlers.get(request.method)
            if (!handler) {
                this.logger('[RPC] [ERROR] Method not found', { method: request.method })
                return JSON.stringify({ error: 'Method not found' })
            }

            const params = safeJsonParse(request.params)
            const result = await handler(params as any)
            return JSON.stringify(result)
        } catch (error) {
            const details = error instanceof Error
                ? { message: error.message, stack: error.stack }
                : { error: String(error) }
            this.logger('[RPC] [ERROR] Error handling request', details)
            return JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
            })
        }
    }

    onSocketConnect(socket: Socket): void {
        this.socket = socket
        this.clearRegisterRetries()
        for (const [prefixedMethod] of this.handlers) {
            this.emitRegister(prefixedMethod)
        }
    }

    onSocketDisconnect(): void {
        this.socket = null
        this.clearRegisterRetries()
    }

    getHandlerCount(): number {
        return this.handlers.size
    }

    hasHandler(method: string): boolean {
        const prefixedMethod = this.getPrefixedMethod(method)
        return this.handlers.has(prefixedMethod)
    }

    clearHandlers(): void {
        this.handlers.clear()
        this.clearRegisterRetries()
        this.logger('Cleared all RPC handlers')
    }

    private getPrefixedMethod(method: string): string {
        return `${this.scopePrefix}:${method}`
    }

    /**
     * Register with hub ack. If another socket still owns the method (reconnect
     * overlap), retry until accepted or this socket disconnects (#1473 Major).
     */
    private emitRegister(prefixedMethod: string, attempt = 0): void {
        const socket = this.socket
        if (!socket) {
            return
        }
        const onAck = (err: Error | null, response?: { registered?: boolean }) => {
            if (this.socket !== socket) {
                return
            }
            // No-ack emitters (unit mocks, older servers): treat as fire-and-forget ok.
            const registered = err
                ? false
                : response === undefined
                    ? true
                    : response.registered === true
            if (registered) {
                const pending = this.registerRetryTimers.get(prefixedMethod)
                if (pending) {
                    clearTimeout(pending)
                    this.registerRetryTimers.delete(prefixedMethod)
                }
                return
            }
            if (attempt >= 40) {
                this.logger('[RPC] register still busy after retries', { method: prefixedMethod })
                return
            }
            const delayMs = Math.min(250 * (attempt + 1), 2_000)
            const timer = setTimeout(() => {
                this.registerRetryTimers.delete(prefixedMethod)
                this.emitRegister(prefixedMethod, attempt + 1)
            }, delayMs)
            this.registerRetryTimers.set(prefixedMethod, timer)
        }

        const payload = { method: prefixedMethod }
        const withTimeout = typeof socket.timeout === 'function'
            ? socket.timeout(5_000)
            : socket
        withTimeout.emit('rpc-register', payload, onAck)
    }

    private clearRegisterRetries(): void {
        for (const timer of this.registerRetryTimers.values()) {
            clearTimeout(timer)
        }
        this.registerRetryTimers.clear()
    }
}

export function createRpcHandlerManager(config: RpcHandlerConfig): RpcHandlerManager {
    return new RpcHandlerManager(config)
}
