import { describe, expect, it, vi } from 'vitest'
import { applyLinkIssue } from './sessionIssueLink'
import type { Metadata } from '@/api/types'

function makeClient(metadata: Metadata, options: { flushResult?: boolean; skipWrite?: boolean } = {}) {
    const { flushResult = true, skipWrite = false } = options
    const state = { metadata }
    const client = {
        updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
            // Mirrors ApiSessionClient's own hub-archived EXIT branch: the
            // handler is never invoked and metadata never changes, but
            // flushMetadata still reports a clean lock drain.
            if (skipWrite) return
            state.metadata = handler(state.metadata)
        }),
        flushMetadata: vi.fn(async () => flushResult),
        getMetadata: vi.fn(() => state.metadata)
    }
    return { client, getMetadata: () => state.metadata }
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

    it('returns an error when the lock never drains (session closed/unreachable)', async () => {
        const { client } = makeClient({ path: '/tmp/project', host: 'localhost' }, { flushResult: false })
        const outcome = await applyLinkIssue(client, 'heavygee/hapi#235')
        expect(outcome.ok).toBe(false)
    })

    it('returns an error when the lock drains but the write was skipped (session hub-archived mid-flight)', async () => {
        // Regression: ApiSessionClient.updateMetadata's hub-archived EXIT
        // branch skips the handler entirely but still lets the backoff loop
        // complete "successfully" — flushMetadata alone can't tell this
        // apart from a real ack, so applyLinkIssue must verify the ref
        // actually landed in client.metadata afterward.
        const { client, getMetadata } = makeClient({ path: '/tmp/project', host: 'localhost' }, { skipWrite: true })
        const outcome = await applyLinkIssue(client, 'heavygee/hapi#235')
        expect(outcome.ok).toBe(false)
        expect(getMetadata().externalRefs).toBeUndefined()
    })
})
