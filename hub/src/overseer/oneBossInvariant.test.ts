import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { loadAndReplay } from './replayHarness'
import { assertOneBossInvariant, checkOneBossInvariant } from './oneBossInvariant'

const FIXTURE_DIR = join(import.meta.dir, '..', '..', '..', 'test', 'fixtures', 'overseer-replay')
const fixture = (name: string) => join(FIXTURE_DIR, `${name}.json`)

describe('One-boss invariant (ADR-001)', () => {
    it('passes vacuously when the stream has no dispatched events', () => {
        const ctx = loadAndReplay(fixture('routine-progress-flood'))
        const result = checkOneBossInvariant(ctx)
        expect(result.checked).toBe(0)
        expect(result.violations).toHaveLength(0)
        expect(() => assertOneBossInvariant(ctx)).not.toThrow()
    })

    it('checks a clean operator-attributed dispatch and finds no violation', () => {
        const ctx = loadAndReplay(fixture('one-boss-clean'))
        const result = checkOneBossInvariant(ctx)
        expect(result.checked).toBe(1)
        expect(result.violations).toHaveLength(0)
        expect(() => assertOneBossInvariant(ctx)).not.toThrow()
    })

    it('catches a leaking dispatch (attribution boilerplate + overseer metadata)', () => {
        const ctx = loadAndReplay(fixture('one-boss-leak'))
        const result = checkOneBossInvariant(ctx)
        expect(result.checked).toBe(1)
        const kinds = new Set(result.violations.map((v) => v.kind))
        expect(kinds.has('attribution-phrase')).toBe(true)
        expect(kinds.has('metadata-key')).toBe(true)
        expect(() => assertOneBossInvariant(ctx)).toThrow(/one-boss/)
    })
})
