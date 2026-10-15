import { describe, expect, it } from 'vitest';
import { MetadataSchema } from './schemas';

describe('MetadataSchema cursorSessionProtocol', () => {
    const base = {
        path: '/tmp',
        host: 'test'
    };

    it('accepts acp and stream-json protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'acp' }).success).toBe(true);
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'stream-json' }).success).toBe(true);
    });

    it('rejects unknown protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'websocket' }).success).toBe(false);
    });

    it('persists Pi native history entry ids', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            conversationHistoryEntryIds: { 'local-user-id': 'pi-entry-id' },
        });
        expect(result.success).toBe(true);
        expect(result.data?.conversationHistoryEntryIds).toEqual({ 'local-user-id': 'pi-entry-id' });
    });
});

describe('MetadataSchema externalRefs github_pr chip (Codex review, hapi#238)', () => {
    // Regression: ExternalRefSchema originally only had a `github_issue`
    // discriminated-union member. The fork's hapi-meta-daily.sh
    // --backfill-refs / md_refs_apply_status tooling already writes
    // `kind: 'github_pr'` entries into metadata.externalRefs in production —
    // a single-case union made MetadataSchema.safeParse reject the ENTIRE
    // metadata object for any session already carrying one (hub then exposes
    // metadata: null, per sessionCache.ts's `parsed.success ? parsed.data :
    // null` fallback), wiping out path/name/flavor/lifecycle too.
    const base = { path: '/tmp', host: 'test' };

    it('does not reject the whole object for a minimal github_pr ref', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/238', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(result.success).toBe(true);
    });

    it('passes through the chip-status fields hapi-meta-daily.sh actually writes, instead of rejecting them', () => {
        // Real shape from md_refs_apply_status: role/source/linkedAt from the
        // initial backfill write, status/statusCheckedAt/estateCode/openState/
        // checks/merge layered on by later chip-status updates.
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{
                kind: 'github_pr',
                url: 'https://github.com/heavygee/hapi/pull/238',
                repo: 'heavygee/hapi',
                number: 238,
                role: 'primary',
                source: 'inferred',
                linkedAt: 1,
                status: 'needs-work',
                statusCheckedAt: 2,
                estateCode: 'fork',
                openState: 'open'
            }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs?.[0]).toMatchObject({ kind: 'github_pr', status: 'needs-work' });
    });

    it('still rejects an actually-malformed ref (missing required github_pr fields)', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/238' }]
        });
        expect(result.success).toBe(false);
    });
});

describe('MetadataSchema externalRefs github_issue url validation (Codex review, hapi#238)', () => {
    // Regression: GithubIssueExternalRefSchema.url accepted any string.
    // `hapi link-issue`/MCP `link_issue` always build this ref via
    // parseIssueUrl, so every ref from this PR's own write paths already
    // satisfies the tightened check below — but the generic CLI
    // update-metadata socket path can set metadata.externalRefs directly,
    // bypassing that validation entirely. Without it, a crafted url like
    // `https://github.com@evil.example/...` (a userinfo component, not the
    // host) renders in IssueRefChip as a trustworthy-looking #N link to an
    // attacker-controlled host.
    const base = { path: '/tmp', host: 'test' };

    it('accepts a canonical github_issue ref matching repo/number', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(true);
    });

    it('rejects a userinfo-deceptive url pointing at a different host than it displays', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com@evil.example/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(false);
    });

    it('rejects a url whose embedded repo/number disagrees with the ref\'s own fields', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/999', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(false);
    });

    it('rejects a non-issue-shaped url entirely', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'not a url at all', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(false);
    });
});
