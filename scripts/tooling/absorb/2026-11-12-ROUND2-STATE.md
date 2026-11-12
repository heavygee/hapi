# ROUND 2 ABSORB — MERGE_HEAD IS LIVE. CONTINUE IT, DO NOT RESET.

**Worktree:** `~/coding/hapi/worktrees/driver-remat`, branch `driver/integration-wip`
**Owner:** session `cbd1073e` (tooling/meta). **Hold:** SET, stays until promote.
**Live tip:** `e3b1e11a8` — UNCHANGED. The atomic remat refused cleanly; nothing shipped.

## Where this is

Round 1 (upstream absorb + fork-UI adaptation) is **done and was green**:
web 431/431 files and 4677/4677 tests, hub+shared 2911/0, required-surface 22/22,
`link_pr` catalog verified ON/OFF/allowlist. That is the 69 commits on the WIP.

Round 2 merges the freshly-synced `origin/main` (upstream 0.35.0) into that WIP.

**47 of 72 conflicted files resolved. 25 left.** `hub/` is fully clear.

| area | left | heaviest |
|---|---|---|
| `web/` | 7 | `SessionRowSummary.tsx` (4 hunks) + `.test.tsx` (3) |
| `ios/` | 7 | `SessionListModel.swift` (5), `SessionListView.swift` (4) |
| `android/` | 6 | `SessionListViewModel.kt`, `SessionListScreen.kt` (2 each) |
| `cli/` | 5 | `spawnHappyCLI.test.ts` (2); rest 1 hunk each |

## READ THIS FIRST — the merge silently narrowed a fork type in a file that never conflicted

`hub/src/fcm/fcmService.ts` was **not** in the conflict set. Git auto-merged it and
took upstream's narrower `severity?: 'info' | 'warning'`, discarding the fork's
`'info' | 'success' | 'warning' | 'error'`. Nothing flagged it. It surfaced only
because a *test* in a different file asserted `severity === 'success'` and typecheck
failed there. Restored.

**225 files auto-merged without conflict.** Each is a place the same thing could have
happened. Typecheck catches the ones with a disagreeing consumer; it does not catch a
narrowed type nobody reads yet. After the merge commits, sweep the auto-merged set for
fork types/unions that upstream narrowed — compare against `e3b1e11a8`, not against
`origin/main`.

## Already decided — do not re-litigate

**`hub/src/store/index.ts`** (staged):
- `REQUIRED_TABLES` — union: fork Overseer tables (`deleted_sessions`, `inbox_items`,
  `inbox_item_source_events`, `inbox_operator_actions`, `overseer_settings`) **plus**
  upstream's `session_turns`, `session_redirects`.
- `currentVersion === 26` fast path — took upstream's three calls.
- `SCHEMA_VERSION` is **35**; `ensureLineageConvergence` intact.

The ladder was the *cheap* part: the spine is upstream's, so their new step appended
without touching the fork's off-ladder self-heal. Upstream reached the **same** v26
fast-path fix independently.

**`hub/src/sync/sessionCache.ts`** (staged) — the trap 2ec10899 flagged on #2147:
upstream has a full *inline reimplementation* of the metadata merge; the fork
externalised it as `mergeSessionMetadataForSessionMerge`. Kept the fork's delegation,
discarded upstream's inline duplicate, and ported the one real gap
(`mergeClaudeSessionIdHistory`) into the fork helper.

**`hub/src/socket/handlers/cli/sessionHandlers.ts`** (staged) — took upstream's
tool-call-folding block but **rebound `createdAt` to `clientCreatedAt`**, because this
handler destructures `const { sid, localId, createdAt: clientCreatedAt }`. Upstream's
block names it `createdAt`; pasting it verbatim is the misaligned-splice failure.

**`shared/src/apiTypes.ts`** (staged) — `union-resolve.py` dropped upstream's new
`ForkConversationRpcResponse` (the error-bearing union over `…Result`). Restored.
The classifier is not infallible; typecheck after `--apply`.

## Known typecheck tail (fix in follow-ups, after the merge commits)

A merge cannot be partially committed, so **get to a merge commit even with typecheck
red**. Imperfect merge commit > pristine conflicted index. Then fix:

- `syncEngine.ts`: duplicate `MACHINE_CAPABILITIES` import; `forkArchivedCodexSession`
  missing on `SyncEngine`; `ForkConversationRpcResponse` needs narrowing before
  `.nativeSessionId` / `.sessionId`
- `fcmNotificationChannel.ts`: `composeTask` missing on `NativeNotificationComposer`
- `notificationHub.test.ts`: `sendTaskNotification` not on `NotificationChannel`
- `web/server.ts`: `createActivityRoutes` used but not imported

All are upstream additions the merge dropped — restore from `origin/main`.

## Native is NOT take-theirs

Tempting, because the WIP's own 69 commits touch **zero** native files — but the soup
tip differs from fork main on **351** native files, because the fork's *layers* carry
native work. `SessionSorting.{kt,swift}` holds the fork's `SessionSummaryComparator`,
an exact port of the web ordering **including `globalPinned`**, which upstream has no
concept of. Upstream has its own session-sorting implementation. Either side alone
loses one of them.

## `web/src/components/SessionRowSummary.{tsx,test.tsx}` is the known-hard one

Round 1 ported upstream's presence badge into this component **and restructured the
row** so the badge sits outside the faded container (the fade means residency;
upstream's test asserts the mark is not dimmed with the title line). Upstream then
churned the same file. Neither side is a superset.

## Order from here

1. Resolve the 25. Hot-file rule: keep **both** the call site and the declaration;
   prefer the fuller helper module over a partial stub.
2. Commit on `driver/integration-wip`.
3. `bun install` (upstream added `ws` + `@types/ws`), then typecheck, then the
   follow-up fixes above, then tests **scoped per package** — `cd hub && bun test`,
   not `bun test hub/src` from the repo root, which globs `node_modules` and reports
   ~89 phantom failures.
4. Sweep the 225 auto-merged files for silently-narrowed fork types (see above).
5. Re-run as owner:
   `HAPI_REMAT_OWNER=1 HAPI_REMAT_OWNER_TOKEN=$(cat ~/.config/hapi/remat-owner.token)`
   `HAPI_SESSION_ID=cbd1073e-… HAPI_REMAT_RESUME=1 HAPI_SKIP_SOUP_SINGLE_EXE=1`
   `hapi-driver-rebuild --build-web --verify`
   (hold-active re-run RESUMES the WIP; it does not wipe the merge commit)
6. Promote lands only if `--verify` passes, which includes the required-surface gate.
   Report the tip and confirm `link_pr` is in the live catalog on :3006.

## Known non-regressions — do not chase

- hub: `loadServerSettings > defaults push settings to null`,
  `TitleSuggestionService > reports unavailable configuration…`
- shared: 3 type errors in `apiTypes.test.ts` / `sessionSummary.test.ts`
  (was 9 across 4 files before the main sync — pre-existing debt, reduced)

## Two estimates I got wrong — size round 3 better

1. I sized this round at "25 files" from the `main`↔`upstream` overlap. It is **72**,
   because the merge runs against 69 commits of WIP, not against fork main.
   **Size from the WIP.**
2. I assumed native would be safe take-theirs because my commits never touched it.
   Wrong — the *layers* do. Check `origin/main...e3b1e11a8`, not the WIP commits.
