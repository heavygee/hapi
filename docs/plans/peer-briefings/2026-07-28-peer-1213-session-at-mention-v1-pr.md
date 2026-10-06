# Peer handoff — #1213 session @-mention **v1** PR babysit

## Parent
- Orchestrator session: `05d9f0f2` (cursor - tooling/meta bot)
- Operator request: spawn peer to babysit the PR for v1 (plain-text `@` session mentions)

## Intake status (orchestrator completed)
- [x] 1 Code search — DONE: `@` autocomplete in composer; Copy reference grammar; no prior session-mention
- [x] 2 Upstream search — DONE: [tiann/hapi#1213](https://github.com/tiann/hapi/issues/1213)
- [x] 3 Playback — DONE: operator dogfood; rejected attachment-chips; locked v1 = text expansion
- [x] 4 Issue — https://github.com/tiann/hapi/issues/1213
- [x] 5 Demo topology — **soup** (layer `feat/session-at-mention-autocomplete` on `:3006`)

## Your assignment (feature peer / PR babysit)
- Own: open upstream PR if missing → cold-review-clean → CI watch → address review → keep merge-ready
- Worktree: `~/coding/hapi/worktrees/session-at-mention`
- Branch: `feat/session-at-mention-autocomplete` @ `45eb07132` (v1 tip)
- Base: `upstream/main`
- Issue: #1213 — `Fixes #1213` in PR body for **v1 only**

### v1 scope (ship this)
- `@` autocomplete over session titles (all flavors); Codex file `@` still works after session hits
- Insert **plain text** via `buildSessionReferenceText` (same as Copy reference)
- Autolink `/sessions/<id>` in transcript (SPA navigate)
- Reuse slash-command autocomplete stack (`useActiveWord` / `useActiveSuggestions`)

### Explicitly NOT v1
- Attachment-style composer chips (reverted)
- Rich / segmented composer (that's **v2** peer `dcc8fd48`)

### Do NOT
- Merge on `tiann/hapi` (only @tiann merges)
- Edit `~/coding/hapi/driver` by hand
- Park soup layers / stack-switch
- Include `docs/operator/`, `docs/plans/`, `CLAUDE.md` in upstream PR
- Expand scope into v2

### Gates
- `bun typecheck && bun run test` in worktree
- `docs/tooling/pr-review-loop.md` cold review before/after push
- Visual dogfood already on soup — attach PNG to PR comment if needed (`hapi-dogfood-shot`)

### Report back
`hapi-ping-peer 05d9f0f2 "Peer #1213 v1: PR <url> cold-review-clean / CI status / blockers"`
