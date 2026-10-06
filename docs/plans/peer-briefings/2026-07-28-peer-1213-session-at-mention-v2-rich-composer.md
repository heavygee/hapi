# Peer handoff — #1215 session @-mention **v2** rich composer

## Parent
- Orchestrator session: `05d9f0f2` (cursor - tooling/meta bot)
- Operator request: spawn peer based on v1 code for full composer redo (inline `@people`-style session mentions)

## Intake status (orchestrator completed)
- [x] 1 Code search — DONE: v1 text expansion on `feat/session-at-mention-autocomplete`; attachment-chip spike reverted
- [x] 2 Upstream search — DONE
- [x] 3 Playback — DONE: operator rejected sidecar chips; needs positional mid-message mentions
- [x] 4 Issue — **https://github.com/tiann/hapi/issues/1215** (v1 remains #1213)
- [x] 5 Demo topology — peer stack or soup after dogfood; do not hand-edit driver

## Your assignment (feature peer)
- Own: spike → implement segmented composer → gates → dogfood → upstream PR with `Fixes #1215`
- Worktree: `~/coding/hapi/worktrees/session-mention-rich-composer`
- Branch: `feat/session-mention-rich-composer` (created from v1 tip `45eb07132`)
- HAPI session: `dcc8fd48` — title `Peer #1215: session @-mention rich composer`
- Read first:
  - `~/coding/hapi/docs/plans/2026-07-28-session-at-mention-v2-rich-composer.md` (fork plan)
  - `docs/tooling/feature-work-lifecycle.md`
  - v1 code: `web/src/router.tsx` (`getAutocompleteSuggestions` `@` branch), `web/src/lib/sessionReference.ts`, HappyComposer textarea path

### v2 goals
- Replace plain textarea composer with segmented / rich editor (feature-flagged)
- `@` pick inserts **session segment at caret** (not tray chips, not only prose dump)
- Multi-mention mid-message: “this → A, that → B”
- Backspace deletes whole token; serialize on send to markdown `[title](/sessions/id)` (agents stay text-safe)
- Keep textarea fallback until Enter/IME/drafts/send-error parity
- Reuse existing `@` autocomplete **picker**; change commit shape only

### Out of scope
- Chipping `/` or `$`
- Auto `ping-peer` on mention
- Merging upstream PRs
- Closing or “fixing” #1213 from your PR

### Do NOT
- Share worktree with v1 peer (`session-at-mention`)
- Block on v1 PR merge to start spike (branch already based on v1 tip)
- `hapi-use-worktree` / stack-switch from agent shell
- Hand-edit `~/coding/hapi/driver`

### Coordination
- v1 babysit peer: `922f2121` / #1213 — rebase onto their tip if they advance `feat/session-at-mention-autocomplete`
- Report: `hapi-ping-peer 05d9f0f2 "Peer #1215: spike decision TipTap|custom / status"`
