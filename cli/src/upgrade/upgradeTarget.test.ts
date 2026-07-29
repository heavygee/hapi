import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    __setUpgradeTargetBaseDirForTests,
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
})
