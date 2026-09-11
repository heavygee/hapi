# Exit reflection: windows-codex-mcp-flake (PR #1824)

## Shipped as

- PR(s): [#1824](https://github.com/tiann/hapi/pull/1824) Fixes [#1823](https://github.com/tiann/hapi/issues/1823) — squash `25af3f8e1`
- Absorber (if superseded): n/a
- Session: Peer #1823: windows codex MCP flake

## Non-code residue

- Root cause was vitest's **default 5s** on the only unit test that real-spawns on Windows (cmd shim → node → MCP initialize), not product logic.
- Prefer **per-test** `{ timeout: 20_000 }` (+ matching in-test handshake wait) over raising `cli/vitest.config.ts` global — matches integration's 20s without slowing the whole unit suite.
- Flake evidence was hub-only #1821 re-run green same SHA; CI red trained reviewers to wave through required checks.
- `hapi link-pr` 404'd until driver absorbed `/cli/sessions/.../external-refs`; chip attached after Meta soup note.
- No soup layer / remat owed (test-only).

## Promote?

- [x] `none` — no durable follow-up (pattern already stated in #1823 / lifecycle is fine)

## Open questions / landmines

- n/a — if Windows real-spawn unit tests grow, keep budgets local to those cases

## Skip

- (not skipped)
