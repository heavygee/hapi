import { describe, expect, it, vi } from 'vitest'
import { buildGithubPrExternalRef } from './externalRefs'
import { buildAttachedGithubPrRefs } from './attachGithubPrRef'

describe('buildAttachedGithubPrRefs', () => {
    it('classifies on first attach when no preserved status', async () => {
        const classify = vi.fn(async () => ({
            status: 'pending' as const,
            statusCheckedAt: 50,
            statusAction: 'CI running'
        }))
        const refs = await buildAttachedGithubPrRefs({
            repo: 'tiann/hapi',
            number: 1219,
            source: 'agent',
            linkedAt: 10,
            existingRefs: [],
            classify
        })
        expect(classify).toHaveBeenCalledWith('tiann/hapi', 1219)
        expect(refs[0]).toMatchObject({
            number: 1219,
            status: 'pending',
            statusCheckedAt: 50,
            statusAction: 'CI running',
            source: 'agent',
            linkedAt: 10
        })
    })

    it('skips classify on same-PR re-link when status is preserved', async () => {
        const classify = vi.fn(async () => ({
            status: 'clean' as const,
            statusCheckedAt: 99,
            statusAction: 'should not win'
        }))
        const existing = [buildGithubPrExternalRef({
            repo: 'tiann/hapi',
            number: 1219,
            source: 'inferred',
            linkedAt: 1,
            status: 'needs_work',
            statusCheckedAt: 2,
            statusAction: 'threads'
        })]
        const refs = await buildAttachedGithubPrRefs({
            repo: 'tiann/hapi',
            number: 1219,
            source: 'agent',
            linkedAt: 20,
            existingRefs: existing,
            classify
        })
        expect(classify).not.toHaveBeenCalled()
        expect(refs[0]).toMatchObject({
            status: 'needs_work',
            statusCheckedAt: 2,
            statusAction: 'threads',
            source: 'agent',
            linkedAt: 20
        })
    })
})
