import { describe, expect, it } from 'bun:test'
import { mergeSessionMetadataForSessionMerge } from './sessionCache'

const prRef = {
    kind: 'github_pr' as const,
    repo: 'tiann/hapi',
    number: 1160,
    url: 'https://github.com/tiann/hapi/pull/1160',
    role: 'primary' as const
}

describe('mergeSessionMetadataForSessionMerge externalRefs', () => {
    it('preserves externalRefs from the old row when the new row omits them', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            name: 'PR session',
            externalRefs: [prRef]
        }
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            flavor: 'cursor'
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        expect(merged.externalRefs).toEqual([prRef])
        expect(merged.path).toBe('/new')
        expect(merged.flavor).toBe('cursor')
        expect(merged.name).toBe('PR session')
    })

    it('unions distinct externalRefs when the new row sets its own (hapi#238)', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            externalRefs: [prRef]
        }
        const replacement = [{
            kind: 'github_pr' as const,
            repo: 'owner/other',
            number: 42,
            url: 'https://github.com/owner/other/pull/42',
            role: 'primary' as const
        }]
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            externalRefs: replacement
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        // New refs stay first; old-only identities are appended (mergeExternalRefs).
        expect(merged.externalRefs).toEqual([...replacement, prRef])
    })

    it('does not treat explicit empty externalRefs as a clear (PUT /external-refs is the clear path)', () => {
        const oldMetadata = {
            path: '/old',
            host: 'old-host',
            externalRefs: [prRef]
        }
        const newMetadata = {
            path: '/new',
            host: 'new-host',
            externalRefs: []
        }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        expect(merged.externalRefs).toEqual([prRef])
    })

    // Review finding: two valid sessions can each independently sit at or
    // near MAX_EXTERNAL_REFS; their union has no cap of its own. Persisting
    // an over-limit array risks failing MetadataSchema validation on the
    // *next* read, which would null out the whole merged metadata object
    // (name, path, flavor, resume ids, everything), not just externalRefs
    // — and by then the old row is already deleted (mergeSessions). Falls
    // back to the surviving (new) row's own pre-merge refs instead of ever
    // persisting an over-limit array.
    it('falls back to the surviving row\'s own refs when the union would exceed MAX_EXTERNAL_REFS', () => {
        const makeRef = (repo: string, number: number) => ({
            kind: 'github_issue' as const,
            repo,
            number,
            url: `https://github.com/${repo}/issues/${number}`,
            linkedAt: number
        })
        const oldRefs = Array.from({ length: 17 }, (_, i) => makeRef('acme/old', i + 1))
        const newRefs = Array.from({ length: 17 }, (_, i) => makeRef('acme/new', i + 1))
        const oldMetadata = { path: '/old', host: 'old-host', externalRefs: oldRefs }
        const newMetadata = { path: '/new', host: 'new-host', externalRefs: newRefs }

        const merged = mergeSessionMetadataForSessionMerge(oldMetadata, newMetadata) as Record<string, unknown>

        // Union of 34 distinct refs exceeds the 32 cap — must not persist
        // it; the new row's own refs stand unchanged.
        const externalRefs = merged.externalRefs as unknown[]
        expect(externalRefs.length).toBeLessThanOrEqual(32)
        expect(externalRefs).toEqual(newRefs)
    })
})
