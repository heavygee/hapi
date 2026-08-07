import { describe, expect, it, mock } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

describe('SyncEngine restartMachineRunner', () => {
    it('refuses Restart for unsupervised runners (use Upgrade instead)', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const stopRunner = mock(async () => undefined)
            ;(engine as any).rpcGateway.stopRunner = stopRunner

            engine.getOrCreateMachine(
                'manual-runner',
                { host: 'proxmox', platform: 'linux', happyCliVersion: '0.20.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'manual-runner', time: Date.now() })

            const result = await engine.restartMachineRunner('manual-runner', 'default')
            expect(result).toEqual({
                type: 'error',
                message: 'Restart requires an external runner supervisor (HAPI_RUNNER_SUPERVISED=1); use Upgrade instead',
                code: 'restart_unavailable',
            })
            expect(stopRunner).not.toHaveBeenCalled()
        } finally {
            engine.stop()
        }
    })

    it('refuses Restart when only versionHandoffDisabled is set (no supervisor proof)', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const stopRunner = mock(async () => undefined)
            ;(engine as any).rpcGateway.stopRunner = stopRunner

            engine.getOrCreateMachine(
                'detached-optout',
                {
                    host: 'laptop',
                    platform: 'linux',
                    happyCliVersion: '0.20.0',
                    // Detached `hapi runner start` can set this without anything to relaunch.
                    versionHandoffDisabled: true,
                },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'detached-optout', time: Date.now() })

            const result = await engine.restartMachineRunner('detached-optout', 'default')
            expect(result).toEqual({
                type: 'error',
                message: 'Restart requires an external runner supervisor (HAPI_RUNNER_SUPERVISED=1); use Upgrade instead',
                code: 'restart_unavailable',
            })
            expect(stopRunner).not.toHaveBeenCalled()
        } finally {
            engine.stop()
        }
    })

    it('stop-runners only when supervisedRestart is advertised', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const stopRunner = mock(async () => undefined)
            ;(engine as any).rpcGateway.stopRunner = stopRunner

            engine.getOrCreateMachine(
                'soup-runner',
                {
                    host: 'driver',
                    platform: 'linux',
                    happyCliVersion: '0.20.0',
                    versionHandoffDisabled: true,
                    supervisedRestart: true,
                },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'soup-runner', time: Date.now() })

            const result = await engine.restartMachineRunner('soup-runner', 'default')
            expect(result).toEqual({ type: 'success', message: 'Runner restart requested' })
            expect(stopRunner).toHaveBeenCalledWith('soup-runner')
        } finally {
            engine.stop()
        }
    })
})
