import { describe, expect, it, vi } from 'vitest'
import { applyLinkIssue } from './sessionIssueLink'
import type { Metadata } from '@/api/types'

function makeClient(metadata: Metadata, flushResult = true) {
    const state = { metadata }
    return {
        client: {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                state.metadata = handler(state.metadata)
            }),
            flushMetadata: vi.fn(async () => flushResult)
        },
        getMetadata: () => state.metadata
    }
}

describe('applyLinkIssue', () => {
    it('writes the parsed ref from a full URL', async () => {
        const { client, getMetadata } = makeClient({ path: '/tmp/project', host: 'localhost' })

        const outcome = await applyLinkIssue(client, 'https://github.com/heavygee/hapi/issues/235')
        expect(outcome.ok).toBe(true)
        expect(getMetadata().externalRefs).toEqual([
            expect.objectContaining({ kind: 'github_issue', repo: 'heavygee/hapi', number: 235 })
        ])
        expect(client.updateMetadata).toHaveBeenCalledTimes(1)
        expect(client.flushMetadata).toHaveBeenCalledTimes(1)
    })

    it('accepts the owner/repo#N shorthand', async () => {
        const { client, getMetadata } = makeClient({ path: '/tmp/project', host: 'localhost' })

        const outcome = await applyLinkIssue(client, 'heavygee/hapi#235')
        expect(outcome.ok).toBe(true)
        expect(getMetadata().externalRefs?.[0]).toMatchObject({ repo: 'heavygee/hapi', number: 235 })
    })

    it('upserts by repo+number instead of appending a duplicate when re-linked', async () => {
        const { client, getMetadata } = makeClient({
            path: '/tmp/project',
            host: 'localhost',
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        })

        await applyLinkIssue(client, 'heavygee/hapi#235')
        expect(getMetadata().externalRefs).toHaveLength(1)
        expect(getMetadata().externalRefs?.[0]?.linkedAt).toBeGreaterThan(1)
    })

    it('keeps other linked issues when linking a different one', async () => {
        const { client, getMetadata } = makeClient({
            path: '/tmp/project',
            host: 'localhost',
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        })

        await applyLinkIssue(client, 'heavygee/hapi#236')
        expect(getMetadata().externalRefs).toHaveLength(2)
        expect(getMetadata().externalRefs?.map((ref) => ref.number).sort()).toEqual([235, 236])
    })

    it('returns an error without writing for an unparsable url', async () => {
        const { client } = makeClient({ path: '/tmp/project', host: 'localhost' })
        const outcome = await applyLinkIssue(client, 'not an issue url')
        expect(outcome.ok).toBe(false)
        expect(client.updateMetadata).not.toHaveBeenCalled()
        expect(client.flushMetadata).not.toHaveBeenCalled()
    })

    it('returns an error when the metadata write never gets acked (session archived/closed)', async () => {
        const { client } = makeClient({ path: '/tmp/project', host: 'localhost' }, false)
        const outcome = await applyLinkIssue(client, 'heavygee/hapi#235')
        expect(outcome.ok).toBe(false)
        if (!outcome.ok) {
            expect(outcome.error).toMatch(/timed out|unreachable/i)
        }
    })
})
