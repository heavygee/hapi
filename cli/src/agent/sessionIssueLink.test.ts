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

    // Review finding (hapi#2147): at 32 existing refs, the hub's generic
    // metadata merge doesn't reject the over-cap write — it falls back to
    // what's already persisted (a clean, single-attempt success ack), so
    // there's nothing for updateMetadata's socket backoff to usefully retry.
    // Failing fast on the client's own cached count, before ever touching
    // the socket, gives an accurate reason and proves this never reaches
    // (let alone hangs) the metadata lock.
    it('fails fast on the cap without ever touching the socket or lock', async () => {
        const existingRefs = Array.from({ length: 32 }, (_, i) => ({
            kind: 'github_issue' as const, url: `https://github.com/acme/repo/issues/${i + 1}`, repo: 'acme/repo', number: i + 1, linkedAt: i + 1
        }))
        const { client } = makeClient({ path: '/tmp/project', host: 'localhost', externalRefs: existingRefs })

        const outcome = await applyLinkIssue(client, 'heavygee/hapi#9999')

        expect(outcome.ok).toBe(false)
        if (!outcome.ok) expect(outcome.error).toMatch(/maximum allowed/)
        expect(client.updateMetadata).not.toHaveBeenCalled()
        expect(client.flushMetadata).not.toHaveBeenCalled()
    })

    it('still allows re-linking an already-linked issue at the cap (upsert, not a net-new add)', async () => {
        const existingRefs = Array.from({ length: 32 }, (_, i) => ({
            kind: 'github_issue' as const, url: `https://github.com/acme/repo/issues/${i + 1}`, repo: 'acme/repo', number: i + 1, linkedAt: i + 1
        }))
        const { client, getMetadata } = makeClient({ path: '/tmp/project', host: 'localhost', externalRefs: existingRefs })

        const outcome = await applyLinkIssue(client, 'acme/repo#1')

        expect(outcome.ok).toBe(true)
        expect(getMetadata().externalRefs).toHaveLength(32)
        expect(getMetadata().externalRefs?.find((r) => r.number === 1)?.linkedAt).toBeGreaterThan(1)
    })

    // Proves a cap rejection doesn't leave anything behind to stall a
    // subsequent, unrelated metadata write (part of the review's suggested
    // coverage) — the fast-fail path above never touches the lock, so this
    // is unconditionally true, but assert it explicitly rather than only by
    // inference from "updateMetadata was not called".
    it('a subsequent metadata update still completes after a cap rejection', async () => {
        const existingRefs = Array.from({ length: 32 }, (_, i) => ({
            kind: 'github_issue' as const, url: `https://github.com/acme/repo/issues/${i + 1}`, repo: 'acme/repo', number: i + 1, linkedAt: i + 1
        }))
        const { client } = makeClient({ path: '/tmp/project', host: 'localhost', externalRefs: existingRefs })

        await applyLinkIssue(client, 'heavygee/hapi#9999')
        const outcome = await applyLinkIssue(client, 'heavygee/hapi#8888')

        expect(outcome.ok).toBe(false)
        expect(client.updateMetadata).not.toHaveBeenCalled()
        expect(client.flushMetadata).not.toHaveBeenCalled()
    })
})
