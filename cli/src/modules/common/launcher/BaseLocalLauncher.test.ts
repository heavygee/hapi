import { describe, expect, it, vi } from 'vitest'
import { Future } from '@/utils/future'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { BaseLocalLauncher } from './BaseLocalLauncher'

type Handler = () => Promise<void> | void

function createHarness(opts?: { queueSize?: number }) {
    const handlers = new Map<string, Handler>()
    let onMessage: ((...args: unknown[]) => void) | null = null
    let size = opts?.queueSize ?? 0
    const abortLog: AbortSignal[] = []

    const queue = {
        size: () => size,
        reset: () => {
            size = 0
        },
        setOnMessage: (callback: ((...args: unknown[]) => void) | null) => {
            onMessage = callback
        },
        push: () => {
            size += 1
            onMessage?.('follow-up', {})
        }
    }

    const rpcHandlerManager = {
        registerHandler: (method: string, handler: Handler) => {
            handlers.set(method, handler)
        }
    }

    return {
        handlers,
        queue,
        rpcHandlerManager,
        abortLog,
        launchStarted: new Future<void>(),
        finishLaunch: new Future<void>(),
        async launch(signal: AbortSignal) {
            abortLog.push(signal)
            this.launchStarted.resolve(undefined)
            await new Promise<void>((resolve) => {
                if (signal.aborted) {
                    resolve()
                    return
                }
                const onAbort = () => resolve()
                signal.addEventListener('abort', onAbort, { once: true })
                void this.finishLaunch.promise.then(() => {
                    signal.removeEventListener('abort', onAbort)
                    resolve()
                })
            })
        }
    }
}

describe('BaseLocalLauncher inbound follow-ups', () => {
    it('does not abort the local process when a hub message arrives mid-launch', async () => {
        const harness = createHarness()
        const launcher = new BaseLocalLauncher({
            label: 'local',
            failureLabel: 'failed',
            queue: harness.queue,
            rpcHandlerManager: harness.rpcHandlerManager,
            launch: (signal) => harness.launch(signal),
            sendFailureMessage: () => {},
            recordLocalLaunchFailure: () => {}
        })

        const runPromise = launcher.run()
        await harness.launchStarted.promise
        harness.queue.push()

        expect(harness.abortLog[0]?.aborted).toBe(false)

        harness.finishLaunch.resolve(undefined)
        await expect(runPromise).resolves.toBe('switch')
        expect(harness.queue.size()).toBe(1)
    })

    it('still switches immediately when messages are already queued before launch', async () => {
        const harness = createHarness({ queueSize: 1 })
        const launch = vi.fn(async () => {})
        const launcher = new BaseLocalLauncher({
            label: 'local',
            failureLabel: 'failed',
            queue: harness.queue,
            rpcHandlerManager: harness.rpcHandlerManager,
            launch,
            sendFailureMessage: () => {},
            recordLocalLaunchFailure: () => {}
        })

        await expect(launcher.run()).resolves.toBe('switch')
        expect(launch).not.toHaveBeenCalled()
    })

    it('keeps Abort RPC abort-and-reset behavior', async () => {
        const harness = createHarness()
        const launcher = new BaseLocalLauncher({
            label: 'local',
            failureLabel: 'failed',
            queue: harness.queue,
            rpcHandlerManager: harness.rpcHandlerManager,
            launch: (signal) => harness.launch(signal),
            sendFailureMessage: () => {},
            recordLocalLaunchFailure: () => {}
        })

        const runPromise = launcher.run()
        await harness.launchStarted.promise
        harness.queue.push()
        await harness.handlers.get(RPC_METHODS.Abort)?.()
        harness.finishLaunch.resolve(undefined)

        await expect(runPromise).resolves.toBe('switch')
        expect(harness.abortLog[0]?.aborted).toBe(true)
        expect(harness.queue.size()).toBe(0)
    })

    it('keeps Switch RPC abort-and-keep-queue behavior', async () => {
        const harness = createHarness()
        const launcher = new BaseLocalLauncher({
            label: 'local',
            failureLabel: 'failed',
            queue: harness.queue,
            rpcHandlerManager: harness.rpcHandlerManager,
            launch: (signal) => harness.launch(signal),
            sendFailureMessage: () => {},
            recordLocalLaunchFailure: () => {}
        })

        const runPromise = launcher.run()
        await harness.launchStarted.promise
        harness.queue.push()
        await harness.handlers.get(RPC_METHODS.Switch)?.()
        harness.finishLaunch.resolve(undefined)

        await expect(runPromise).resolves.toBe('switch')
        expect(harness.abortLog[0]?.aborted).toBe(true)
        expect(harness.queue.size()).toBe(1)
    })

    it('exits when the local process finishes with an empty queue', async () => {
        const harness = createHarness()
        const launcher = new BaseLocalLauncher({
            label: 'local',
            failureLabel: 'failed',
            queue: harness.queue,
            rpcHandlerManager: harness.rpcHandlerManager,
            launch: (signal) => harness.launch(signal),
            sendFailureMessage: () => {},
            recordLocalLaunchFailure: () => {}
        })

        const runPromise = launcher.run()
        await harness.launchStarted.promise
        harness.finishLaunch.resolve(undefined)
        await expect(runPromise).resolves.toBe('exit')
    })
})
