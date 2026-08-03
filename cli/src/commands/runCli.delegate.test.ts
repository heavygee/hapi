import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { spawnDurableUpgradeDelegate, waitForDelegatedRunner } from './runCli'
import type { ChildProcess } from 'node:child_process'

describe('waitForDelegatedRunner', () => {
    it('rejects on asynchronous spawn error so the marker can be cleared', async () => {
        const child = new EventEmitter() as EventEmitter & ChildProcess
        const pending = waitForDelegatedRunner(child)
        queueMicrotask(() => {
            child.emit('error', new Error('ENOENT'))
        })
        await expect(pending).rejects.toThrow(/ENOENT/)
    })

    it('resolves with the exit code on clean exit', async () => {
        const child = new EventEmitter() as EventEmitter & ChildProcess
        const pending = waitForDelegatedRunner(child)
        queueMicrotask(() => {
            child.emit('exit', 7, null)
        })
        await expect(pending).resolves.toBe(7)
    })
})

describe('spawnDurableUpgradeDelegate', () => {
    it('routes Windows .cmd durable targets through cross-spawn without shell:true', () => {
        const spawnImpl = vi.fn()
        const crossSpawnImpl = vi.fn(() => ({ pid: 99 }) as ChildProcess)
        const upgradePath = 'C:\\Users\\me\\AppData\\Roaming\\npm\\hapi.cmd'
        const workspaceRoot = 'C:\\work\\A & B'
        const args = ['runner', 'start-sync', '--workspace-root', workspaceRoot]

        spawnDurableUpgradeDelegate(upgradePath, args, {
            platform: 'win32',
            spawnImpl: spawnImpl as never,
            crossSpawnImpl: crossSpawnImpl as never,
        })

        expect(spawnImpl).not.toHaveBeenCalled()
        expect(crossSpawnImpl).toHaveBeenCalledTimes(1)
        const [command, passedArgs, options] = crossSpawnImpl.mock.calls[0] as [
            string,
            string[],
            { shell?: boolean; env?: NodeJS.ProcessEnv },
        ]
        expect(command).toBe(upgradePath)
        expect(passedArgs).toEqual(args)
        expect(passedArgs[3]).toBe(workspaceRoot)
        expect(options.shell).toBeUndefined()
        expect(options.env?.HAPI_CLI_EXECUTABLE).toBe(upgradePath)
    })

    it('uses plain spawn for non-shim Windows executables', () => {
        const spawnImpl = vi.fn(() => ({ pid: 42 }) as ChildProcess)
        const crossSpawnImpl = vi.fn()
        const upgradePath = 'C:\\Users\\me\\.hapi\\artifacts\\hapi.exe'

        spawnDurableUpgradeDelegate(upgradePath, ['runner', 'start'], {
            platform: 'win32',
            spawnImpl: spawnImpl as never,
            crossSpawnImpl: crossSpawnImpl as never,
        })

        expect(crossSpawnImpl).not.toHaveBeenCalled()
        expect(spawnImpl).toHaveBeenCalledTimes(1)
        const [, , options] = spawnImpl.mock.calls[0] as [string, string[], { shell?: boolean }]
        expect(options.shell).toBeUndefined()
    })
})
