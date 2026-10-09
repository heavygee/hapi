import { describe, expect, it, vi } from 'vitest'
import { applyLinkIssue } from './sessionIssueLink'
import type { Metadata } from '@/api/types'

describe('applyLinkIssue', () => {
    it('writes the parsed ref from a full URL', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost' }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        const outcome = applyLinkIssue(client, 'https://github.com/heavygee/hapi/issues/235')
        expect(outcome.ok).toBe(true)
        expect(metadata.externalRefs).toEqual([
            expect.objectContaining({ kind: 'github_issue', repo: 'heavygee/hapi', number: 235 })
        ])
        expect(client.updateMetadata).toHaveBeenCalledTimes(1)
    })

    it('accepts the owner/repo#N shorthand', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost' }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        const outcome = applyLinkIssue(client, 'heavygee/hapi#235')
        expect(outcome.ok).toBe(true)
        expect(metadata.externalRefs?.[0]).toMatchObject({ repo: 'heavygee/hapi', number: 235 })
    })

    it('upserts by repo+number instead of appending a duplicate when re-linked', () => {
        let metadata: Metadata = {
            path: '/tmp/project',
            host: 'localhost',
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applyLinkIssue(client, 'heavygee/hapi#235')
        expect(metadata.externalRefs).toHaveLength(1)
        expect(metadata.externalRefs?.[0]?.linkedAt).toBeGreaterThan(1)
    })

    it('keeps other linked issues when linking a different one', () => {
        let metadata: Metadata = {
            path: '/tmp/project',
            host: 'localhost',
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applyLinkIssue(client, 'heavygee/hapi#236')
        expect(metadata.externalRefs).toHaveLength(2)
        expect(metadata.externalRefs?.map((ref) => ref.number).sort()).toEqual([235, 236])
    })

    it('returns an error without writing for an unparsable url', () => {
        const client = { updateMetadata: vi.fn() }
        const outcome = applyLinkIssue(client, 'not an issue url')
        expect(outcome.ok).toBe(false)
        expect(client.updateMetadata).not.toHaveBeenCalled()
    })
})
