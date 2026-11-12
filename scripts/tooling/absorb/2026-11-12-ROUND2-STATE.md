# ROUND 2 ABSORB — MERGE_HEAD IS LIVE. CONTINUE IT, DO NOT RESET.

**Worktree:** `~/coding/hapi/worktrees/driver-remat`, branch `driver/integration-wip`
**Owner:** session `cbd1073e` (tooling/meta). **Hold:** SET, stays until promote.
**Live tip:** `e3b1e11a8` — UNCHANGED. The atomic remat refused cleanly; nothing shipped.

## Where this is

Round 1 (upstream absorb + fork-UI adaptation) is **done and was green**:
web 431/431 files and 4677/4677 tests, hub+shared 2911/0, required-surface 22/22,
`link_pr` catalog verified ON/OFF/allowlist. That work is the 69 commits on the WIP.

Round 2 is merging the freshly-synced `origin/main` (upstream 0.35.0, 28 commits)
into that WIP. **294 files resolved and staged. 33 files still conflicted, 53 hunks.**

## DO NOT

- **Do not run prepare / `HAPI_REMAT_RESUME=0`.** `driver_remat_prepare` resumes only
  with no `MERGE_HEAD`, a porcelain-clean tree, and HEAD descending from `start_ref`.
  Anything else and it runs `merge --abort` + hard reset, which wipes this.
- **Do not `git stash`.** The stash ref is shared across worktrees in this repo.
- **Do not take a side wholesale on native (`android/`, `ios/`).** See below.

## What is already decided — do not re-litigate

**`hub/src/store/index.ts` is RESOLVED and staged.** Both hunks:

1. `REQUIRED_TABLES` — union. The fork's Overseer tables (`deleted_sessions`,
   `inbox_items`, `inbox_item_source_events`, `inbox_operator_actions`,
   `overseer_settings`) **plus** upstream's `session_turns` and `session_redirects`.
2. The `currentVersion === 26` fast path — took upstream's three calls
   (`migrateFromV33ToV34`, `migrateFromV34ToV35`, `ensureUsageScanParserVersion`).

`SCHEMA_VERSION` is now **35**, and `ensureLineageConvergence` is intact.

This is the convergence working as designed: the ladder spine is upstream's, so a new
upstream step appends without touching the fork's off-ladder self-heal. Upstream also
reached the **same** v26 fast-path fix independently — two parties, one answer.

**The ladder is the cheap part of this round. Leave it alone.**

## The remaining 33 — all MANUAL, none mechanically provable

`union-resolve.py --check` on them returns `fully-resolvable files: 0 of 33`.
The provable subset was already applied and staged.

| area | files | notes |
|---|---|---|
| `ios/` | 7 | heaviest: `SessionListModel.swift` (5 hunks), `SessionListView.swift` (4) |
| `web/` | 7 | `SessionRowSummary.tsx` (4) + `.test.tsx` (3) — see below |
| `cli/` | 7 | |
| `android/` | 6 | `SessionListViewModel.kt`, `SessionListScreen.kt` (2 each) |
| `hub/` | 5 | `sessionCache`, `rpcGateway`, `sessionHandlers` (2 each) |
| `.github/` | 1 | `test.yml` — same union as fork main: keep the fork's quarantine gate + Linux codex-mcp stand-in, adopt upstream's wider e2e list |

### Native (`android/` + `ios/`) is NOT take-theirs

Tempting, because the WIP's own 69 commits touch **zero** native files. But the soup
tip differs from fork main on **351** native files — the fork's *layers* carry native
work. Concretely, `SessionSorting.kt` / `SessionSorting.swift` hold the fork's
`SessionSummaryComparator`, an exact port of the web `sortSessionSummaries` ordering
**including `globalPinned`**, which upstream has no concept of. Upstream has its own
session-sorting implementation. Taking either side alone loses one of them.

### `web/src/components/SessionRowSummary.{tsx,test.tsx}` is the known-hard one

Round 1 ported upstream's presence badge into this component **and restructured the
row** so the badge sits outside the faded container (the row fade means residency;
upstream's test asserts the mark is not dimmed with the title line). Upstream then
churned the same file. This needs a real union — neither side is a superset.

## Order from here

1. Resolve the 33. Hot-file rule from round 1 still applies: keep **both** the call
   site and the declaration; prefer the fuller helper module over a partial stub.
2. Commit on `driver/integration-wip`. A merge cannot be partially committed, so get
   to a merge commit even if typecheck is still red — fix with follow-ups on the
   same branch. **Imperfect merge commit > pristine conflicted index.**
3. `bun install` (upstream added `ws` + `@types/ws`), then typecheck, then
   `bun test` scoped per package — **not** `bun test <dir>` from the repo root, which
   globs into `node_modules` and reported 89 phantom failures.
4. Re-run as owner:
   `HAPI_REMAT_OWNER=1 HAPI_REMAT_OWNER_TOKEN=$(cat ~/.config/hapi/remat-owner.token)`
   `HAPI_SESSION_ID=cbd1073e-… HAPI_REMAT_RESUME=1 HAPI_SKIP_SOUP_SINGLE_EXE=1`
   `hapi-driver-rebuild --build-web --verify`
   (hold-active re-run RESUMES the WIP; it does not wipe the merge commit)
5. Promote lands only if `--verify` passes, which includes the required-surface gate.
   Report the tip and confirm `link_pr` is in the live catalog on :3006.

## Known non-regressions — do not chase

- hub: `loadServerSettings > defaults push settings to null`,
  `TitleSuggestionService > reports unavailable configuration…`
- shared: 3 type errors in `apiTypes.test.ts` / `sessionSummary.test.ts`
  (was 9 across 4 files before the main sync — pre-existing debt, reduced)

## One estimate I got wrong

I sized this round at "25 files" from the `main`↔`upstream` overlap. The actual
conflict surface is **72 files**, because the merge runs against 69 commits of WIP,
not against fork main. Size round 3 from the WIP, not from main.
