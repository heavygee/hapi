import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { waitForDelegatedRunner } from './runCli'
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
