import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    __setUpgradeTargetBaseDirForTests,
    clearUpgradeTarget,
    isAuthorizedRunnerHandoff,
    isRunnerStartCliArgs,
    readUpgradeTarget,
    shouldDelegateToUpgradeTarget,
    writeUpgradeTarget,
    upgradeTargetMarkerPath,
} from './upgradeTarget'

describe('upgradeTarget', () => {
    let home: string

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'hapi-upgrade-target-'))
        __setUpgradeTargetBaseDirForTests(home)
    })

    afterEach(() => {
        __setUpgradeTargetBaseDirForTests(null)
        rmSync(home, { recursive: true, force: true })
    })

    it('round-trips structured marker JSON', () => {
        const path = join(home, 'hapi-0.25.1-aaaaaaaaaaaaaaaa')
        writeFileSync(path, '#!binary\n')

        writeUpgradeTarget({
            path,
            targetVersion: '0.25.1',
            targetCapabilities: ['runner-self-upgrade'],
        })

        expect(upgradeTargetMarkerPath()).toBe(join(home, 'bin', '.hapi-upgrade-target'))
        expect(readUpgradeTarget()).toMatchObject({
            path,
            targetVersion: '0.25.1',
            targetCapabilities: ['runner-self-upgrade'],
        })
    })

    it('atomically replaces an existing marker via temp+rename', () => {
        const first = join(home, 'hapi-old')
        const second = join(home, 'hapi-new')
        writeFileSync(first, 'a')
        writeFileSync(second, 'b')
        writeUpgradeTarget({ path: first, targetVersion: '0.1.0' })
        writeUpgradeTarget({ path: second, targetVersion: '0.2.0', targetGeneration: 'gen-2' })
        expect(readUpgradeTarget()).toMatchObject({
            path: second,
            targetVersion: '0.2.0',
            targetGeneration: 'gen-2',
        })
        expect(existsSync(`${upgradeTargetMarkerPath()}.${process.pid}.tmp`)).toBe(false)
    })

    it('reads legacy plain-path markers', () => {
        const path = join(home, 'hapi-legacy')
        writeFileSync(path, 'x')
        writeUpgradeTarget({ path, targetVersion: '0.1.0' })
        writeFileSync(upgradeTargetMarkerPath(), `${path}\n`)

        expect(readUpgradeTarget()).toMatchObject({ path, targetVersion: '' })
    })

    it('does not delegate when the target is the current executable', () => {
        expect(shouldDelegateToUpgradeTarget({
            path: process.execPath,
            targetVersion: '0.25.1',
            updatedAt: Date.now(),
        })).toBe(false)
    })

    it('does not delegate for source bun runs without HAPI_CLI_EXECUTABLE', () => {
        const previous = process.env.HAPI_CLI_EXECUTABLE
        delete process.env.HAPI_CLI_EXECUTABLE
        try {
            const path = join(home, 'hapi-other')
            writeFileSync(path, 'x')
            expect(shouldDelegateToUpgradeTarget({
                path,
                targetVersion: '0.25.1',
                updatedAt: Date.now(),
            })).toBe(false)
        } finally {
            if (previous === undefined) {
                delete process.env.HAPI_CLI_EXECUTABLE
            } else {
                process.env.HAPI_CLI_EXECUTABLE = previous
            }
        }
    })

    it('clears a durable target marker so a broken path cannot restart-loop', () => {
        const path = join(home, 'hapi-gone')
        writeFileSync(path, 'x')
        writeUpgradeTarget({ path, targetVersion: '0.25.1' })
        expect(existsSync(upgradeTargetMarkerPath())).toBe(true)
        clearUpgradeTarget()
        expect(existsSync(upgradeTargetMarkerPath())).toBe(false)
        expect(readUpgradeTarget()).toBeNull()
    })

    it('does not delegate during an authorized handoff even when a prior marker exists', () => {
        const previousExe = process.env.HAPI_CLI_EXECUTABLE
        const previousPid = process.env.HAPI_RUNNER_HANDOFF_FROM_PID
        const markerPath = join(home, 'hapi-old-gen')
        const candidatePath = join(home, 'hapi-new-gen')
        writeFileSync(markerPath, 'old')
        writeFileSync(candidatePath, 'new')
        writeUpgradeTarget({
            path: markerPath,
            targetVersion: '0.25.1',
            targetGeneration: 'gen-a',
        })
        process.env.HAPI_CLI_EXECUTABLE = candidatePath
        process.env.HAPI_RUNNER_HANDOFF_FROM_PID = '12345'
        try {
            expect(isAuthorizedRunnerHandoff()).toBe(true)
            const target = readUpgradeTarget()
            expect(target?.path).toBe(markerPath)
            expect(shouldDelegateToUpgradeTarget(target!)).toBe(false)
        } finally {
            if (previousExe === undefined) {
                delete process.env.HAPI_CLI_EXECUTABLE
            } else {
                process.env.HAPI_CLI_EXECUTABLE = previousExe
            }
            if (previousPid === undefined) {
                delete process.env.HAPI_RUNNER_HANDOFF_FROM_PID
            } else {
                process.env.HAPI_RUNNER_HANDOFF_FROM_PID = previousPid
            }
        }
    })
})

describe('isRunnerStartCliArgs', () => {
    it('matches only runner start / start-sync (not hub or other commands)', () => {
        expect(isRunnerStartCliArgs(['runner', 'start-sync'])).toBe(true)
        expect(isRunnerStartCliArgs(['runner', 'start'])).toBe(true)
        expect(isRunnerStartCliArgs(['runner', 'stop'])).toBe(false)
        expect(isRunnerStartCliArgs(['hub'])).toBe(false)
        expect(isRunnerStartCliArgs(['doctor'])).toBe(false)
        expect(isRunnerStartCliArgs([])).toBe(false)
    })
})
