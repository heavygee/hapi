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

    it('drops an actually-malformed ref (missing required github_pr fields) instead of rejecting the whole metadata object', () => {
        // Updated (Codex review, hapi#238): externalRefs is now preprocessed
        // through toValidExternalRefs before MetadataSchema validates it, so
        // a single malformed element no longer fails this WHOLE field (and
        // therefore the whole MetadataSchema.safeParse call) — it's silently
        // dropped instead, same as every other externalRefs consumer in the
        // hub already does. This test previously asserted the since-replaced
        // "rejects the whole object" behavior.
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/238' }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });
});

describe('MetadataSchema externalRefs github_pr url validation (operator decision, hapi#238)', () => {
    // Reconciled with the upstream-shaped schema already running in
    // driver/soup (tiann/hapi#1160-#1163), which independently arrived at
    // the same strict-URL-match requirement for the same reason the
    // github_issue schema above was hardened: url/repo/number identity is
    // universal, not a HAPI-specific workflow concern.
    const base = { path: '/tmp', host: 'test' };

    it('accepts a canonical github_pr ref matching repo/number', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/238', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(result.success).toBe(true);
    });

    it('drops a userinfo-deceptive url pointing at a different host than it displays, instead of rejecting the whole object', () => {
        // Updated (Codex review, hapi#238): see the drops-malformed-ref test
        // above for why MetadataSchema now sanitizes rather than rejects.
        // The underlying GithubPrExternalRefSchema itself still rejects this
        // exact ref when tested directly — see schemas.externalRefs.test.ts.
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com@evil.example/heavygee/hapi/pull/238', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });

    it('drops a url whose embedded repo/number disagrees with the ref\'s own fields, instead of rejecting the whole object', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'https://github.com/heavygee/hapi/pull/999', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });

    it('still passes through role/source/linkedAt and unrelated chip-status fields on an otherwise-valid ref', () => {
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
                estateCode: 'fork'
            }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs?.[0]).toMatchObject({ role: 'primary', status: 'needs-work', estateCode: 'fork' });
    });

    it('rewrites a non-canonical but otherwise-valid url to the canonical https form (Codex review)', () => {
        // Regression: a plain string-match check only confirmed the *parsed*
        // repo/number agreed, never that the stored url equaled the parser's
        // own canonical reconstruction. A ref stored as http:// rendered a
        // cleartext link; one stored scheme-less rendered as a broken
        // same-origin relative link, since IssueRefChip/the PR chip render
        // `ref.url` verbatim.
        const httpResult = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'http://github.com/heavygee/hapi/pull/238', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(httpResult.success).toBe(true);
        expect(httpResult.data?.externalRefs?.[0]).toMatchObject({ url: 'https://github.com/heavygee/hapi/pull/238' });

        const schemelessResult = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_pr', url: 'github.com/heavygee/hapi/pull/238', repo: 'heavygee/hapi', number: 238 }]
        });
        expect(schemelessResult.success).toBe(true);
        expect(schemelessResult.data?.externalRefs?.[0]).toMatchObject({ url: 'https://github.com/heavygee/hapi/pull/238' });
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

    it('drops a userinfo-deceptive url pointing at a different host than it displays, instead of rejecting the whole object', () => {
        // Updated (Codex review, hapi#238): MetadataSchema's externalRefs is
        // now preprocessed through toValidExternalRefs, so a malformed
        // element is dropped rather than failing this whole field (and
        // therefore the whole MetadataSchema.safeParse call) — a
        // single bad ref must never corrupt the rest of a session's cached
        // metadata (title, flavor, path, host, resume tokens, ...). The
        // underlying GithubIssueExternalRefSchema itself still rejects this
        // exact ref when tested directly — see schemas.externalRefs.test.ts.
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com@evil.example/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });

    it('drops a url whose embedded repo/number disagrees with the ref\'s own fields, instead of rejecting the whole object', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/999', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });

    it('rewrites a non-canonical but otherwise-valid url to the canonical https form (Codex review)', () => {
        const httpResult = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'http://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(httpResult.success).toBe(true);
        expect(httpResult.data?.externalRefs?.[0]).toMatchObject({ url: 'https://github.com/heavygee/hapi/issues/235' });

        const schemelessResult = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(schemelessResult.success).toBe(true);
        expect(schemelessResult.data?.externalRefs?.[0]).toMatchObject({ url: 'https://github.com/heavygee/hapi/issues/235' });
    });

    it('drops a non-issue-shaped url entirely, instead of rejecting the whole object', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            externalRefs: [{ kind: 'github_issue', url: 'not a url at all', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }]
        });
        expect(result.success).toBe(true);
        expect(result.data?.externalRefs).toEqual([]);
    });
});

describe('MetadataSchema preserves the rest of a session\'s metadata around a malformed ref (Codex review, hapi#238)', () => {
    // A malformed externalRefs element used to fail MetadataSchema.safeParse
    // entirely, exposing session.metadata as null for that session (hub's
    // sessionCache.ts `parsed.success ? parsed.data : null` fallback). `hapi
    // link-issue`/MCP `link_issue`'s own `session.metadata ?? { path: '',
    // host: '' }` fallback then overwrote the real title/flavor/path/host/
    // resume-tokens with that near-empty object on the very next link call —
    // discarding everything just because one unrelated ref didn't parse.
    it('keeps title, flavor, and other fields intact alongside a dropped malformed ref', () => {
        const result = MetadataSchema.safeParse({
            path: '/home/user/project',
            host: 'oos-linux',
            name: 'Important session title',
            flavor: 'claude',
            externalRefs: [
                { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 },
                { kind: 'github_issue' } // malformed: missing url/repo/number/linkedAt
            ]
        });
        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('Important session title');
        expect(result.data?.flavor).toBe('claude');
        expect(result.data?.path).toBe('/home/user/project');
        expect(result.data?.host).toBe('oos-linux');
        expect(result.data?.externalRefs).toEqual([
            { kind: 'github_issue', url: 'https://github.com/heavygee/hapi/issues/235', repo: 'heavygee/hapi', number: 235, linkedAt: 1 }
        ]);
    });
});
