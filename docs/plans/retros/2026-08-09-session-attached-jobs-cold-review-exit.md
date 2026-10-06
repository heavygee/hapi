# Exit reflection: session-attached jobs cold review (PR #1424)

> Review-lane retro (not the feature peer's). Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): [tiann/hapi#1424](https://github.com/tiann/hapi/pull/1424) (feature) — issue [#1404](https://github.com/tiann/hapi/issues/1404)
- Absorber (if superseded): n/a
- Session: `d3184c43` (cold review pass 3, Cursor Opus) — reviewer only; feature peer is `6e70f97b`
- Verdict trail: NO @ `228e5f779` → NO @ `968ff8b0a` → **YES** @ `6fb81a39f`

## Non-code residue

- **Run the suite; don't just read the diff.** All 25 pass-3 Blocker failures were mechanical fixture drift invisible on read-through: injecting a shared prompt block broke 10 Codex `appServerConfig` fixtures plus 2 OpenCode/runAgentSession assertions, and bumping `SCHEMA_VERSION` broke 10 migration tests hard-coding `user_version` 21. A diff-only cold read would have returned YES on red CI.
- **When a branch claims "fixed + added a test", build the fixture the test avoids.** The merge-metadata clobber survived pass 2 because the branch's own test gave both sessions identical metadata, so `mergeSessionMetadata` returned `changed=false` and never wrote. A reviewer probe with the old session contributing `name` exposed a lost write that killed the post-merge `$HAPI_SESSION_ID` redirect.
- **Validate reviewer fixtures against the schema before believing a failure.** One of my probes produced a false positive: an invalid `worktree` shape failed `MetadataSchema`, so `refreshSession` nulled the whole metadata object and the redirect looked broken. Nearly reported pre-existing behavior as a new Major.
- **A fix for a waste/perf Minor on a long-lived process needs a credential-lifetime check.** Closing "don't re-exchange the JWT every heartbeat" introduced resolve-once, which silently died at the hub's 4h JWT expiry — on the one path (`hapi job run`) documented for days-long work, with the error swallowed by `.catch(() => {})`. Third pass caught it only by grepping the hub's `setExpirationTime`.
- **MCP input schema is a permission surface.** An optional `sessionId` on an auto-approved tool quietly turned an "own-session" meter into an unprompted cross-session write in read-only/plan mode — while `ping_peer` is deliberately gated for exactly that reason. Comments claimed own-session; the schema disagreed.
- Verdict-per-pass with `path:line` plus a reproduction beat prose severity claims: every Major I could reproduce got fixed in one turn; the ones I could only argue (steer ordering, discoverability) stayed open as Minors.

## Promote?

Pick one primary (and optional second):

- [ ] `none` — no durable follow-up
- [ ] `High-signal index` — one row for `docs/operator/AGENTS.md` (paste proposed row)
- [x] `lifecycle / tooling doc` — `docs/tooling/cold-pr-review-rubric.md`: add two lines to "What to check" — (1) run `bun typecheck && bun run test` before any verdict, never verdict on a diff read alone; (2) when the diff claims a fix plus a regression test, construct the fixture that test avoids before accepting it.
- [x] `tooling issue` — "Migration tests hard-code `user_version`" — 10 hub test files assert the literal schema version, so every bump is a 10-file edit and a guaranteed red CI for the unwary. Replace with the exported `SCHEMA_VERSION` constant.

## Open questions / landmines

- **#1424 is OPEN and green, not merged** (`mergeable: CLEAN`, `test` + `pr-review` SUCCESS, no review decision, zero comments) — awaiting @tiann on lane A. Feature session `6e70f97b` should stay live to babysit; do not archive it or drop its soup layer / worktree until merge.
- Root `AGENTS.md` gains 15 lines, so byte-identity with upstream (the Codex Cloud RAG-parity invariant) is broken until this merges.
- Terminal-job TTL / reclaim is still backlog: a SIGKILLed `hapi job run` leaves a `running` meter forever, which is the "stuck chip with a dead PID" failure the guide itself warns about.
- Sustained heartbeat is only structurally solved by `hapi job run`; the steer still lists MCP set-then-update first and then admits an idle agent cannot heartbeat. Worth measuring which one real agents actually pick.
- Uncommitted nits left with the feature peer: 401 → `auth_failed` mapping exists only on `update`; the proactive >3h JWT refresh has no committed test (verified only by my throwaway probe).
