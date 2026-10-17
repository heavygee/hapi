import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSettingsFile, readSettings } from '../config/settings'
import {
    getEffectiveFleetUpgradePolicy,
    getFleetUpgradeMachinePolicies,
    getFleetUpgradePolicy,
    initFleetUpgradePolicy,
    resetFleetUpgradePolicyForTests,
    setFleetUpgradeMachinePolicy,
    setFleetUpgradePolicy,
} from './fleetUpgradePolicy'

const tmpDirs: string[] = []

function makeDataDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-policy-'))
    tmpDirs.push(dir)
    return dir
}

afterEach(() => {
    resetFleetUpgradePolicyForTests()
    for (const dir of tmpDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('fleetUpgradePolicy', () => {
    it('defaults to auto when nothing is persisted (#292)', () => {
        initFleetUpgradePolicy({ dataDir: makeDataDir(), persisted: undefined })
        expect(getFleetUpgradePolicy()).toBe('auto')
    })

    it('seeds from a valid persisted value and ignores garbage', () => {
        initFleetUpgradePolicy({ dataDir: makeDataDir(), persisted: 'silent' })
        expect(getFleetUpgradePolicy()).toBe('silent')

        initFleetUpgradePolicy({ dataDir: makeDataDir(), persisted: 'nonsense' })
        expect(getFleetUpgradePolicy()).toBe('auto')
    })

    it('persists updates to settings.json and survives re-init', async () => {
        const dataDir = makeDataDir()
        initFleetUpgradePolicy({ dataDir, persisted: undefined })

        await setFleetUpgradePolicy('silent')
        expect(getFleetUpgradePolicy()).toBe('silent')

        const persisted = await readSettings(getSettingsFile(dataDir))
        expect(persisted?.fleetUpgradePolicy).toBe('silent')

        // Simulate a hub restart reading the file back.
        resetFleetUpgradePolicyForTests()
        initFleetUpgradePolicy({ dataDir, persisted: persisted?.fleetUpgradePolicy })
        expect(getFleetUpgradePolicy()).toBe('silent')
    })

    it('refuses to overwrite a malformed settings.json', async () => {
        const dataDir = makeDataDir()
        const file = getSettingsFile(dataDir)
        writeFileSync(file, '{not-json')
        initFleetUpgradePolicy({ dataDir, persisted: 'alert' })

        await expect(setFleetUpgradePolicy('silent')).rejects.toThrow(/Cannot read/)
        expect(getFleetUpgradePolicy()).toBe('alert')
        expect(readFileSync(file, 'utf8')).toBe('{not-json')
    })

    it('serializes overlapping policy writes so the last request wins', async () => {
        const dataDir = makeDataDir()
        initFleetUpgradePolicy({ dataDir, persisted: 'alert' })
        // Seed a settings file with an unrelated field that must survive RMW races.
        const file = getSettingsFile(dataDir)
        writeFileSync(file, `${JSON.stringify({ cliApiToken: 'keep-me', fleetUpgradePolicy: 'alert' }, null, 2)}\n`)

        await Promise.all([
            setFleetUpgradePolicy('silent'),
            setFleetUpgradePolicy('auto'),
            setFleetUpgradePolicy('alert'),
            setFleetUpgradePolicy('silent'),
        ])
        expect(getFleetUpgradePolicy()).toBe('silent')
        const persisted = await readSettings(file)
        expect(persisted?.fleetUpgradePolicy).toBe('silent')
        expect(persisted?.cliApiToken).toBe('keep-me')
        // File must remain valid JSON (no half-written tmp clobber).
        expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
    })

    it('stores per-machine overrides without changing hub default', async () => {
        const dataDir = makeDataDir()
        initFleetUpgradePolicy({ dataDir, persisted: 'alert' })
        await setFleetUpgradePolicy('alert') // persist hub default before machine RMW
        expect(getEffectiveFleetUpgradePolicy('ninja')).toBe('alert')

        await setFleetUpgradeMachinePolicy('ninja', 'auto')
        expect(getFleetUpgradePolicy()).toBe('alert')
        expect(getEffectiveFleetUpgradePolicy('ninja')).toBe('auto')
        expect(getFleetUpgradeMachinePolicies()).toEqual({ ninja: 'auto' })

        const persisted = await readSettings(getSettingsFile(dataDir))
        expect(persisted?.fleetUpgradePolicy).toBe('alert')
        expect(persisted?.fleetUpgradeMachinePolicies).toEqual({ ninja: 'auto' })

        resetFleetUpgradePolicyForTests()
        initFleetUpgradePolicy({
            dataDir,
            persisted: persisted?.fleetUpgradePolicy,
            persistedMachinePolicies: persisted?.fleetUpgradeMachinePolicies,
        })
        expect(getEffectiveFleetUpgradePolicy('ninja')).toBe('auto')
        expect(getEffectiveFleetUpgradePolicy('homelab')).toBe('alert')

        await setFleetUpgradeMachinePolicy('ninja', null)
        expect(getEffectiveFleetUpgradePolicy('ninja')).toBe('alert')
        expect(getFleetUpgradeMachinePolicies()).toEqual({})
    })
})
