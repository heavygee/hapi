# Soup cannot absorb the 2026-11-10 upstream sync without a 332-hunk reconciliation

**Status:** stopped deliberately, not abandoned. **Live tip `e3b1e11a8` is unchanged and
serving**; hold cleared; `hapi-driver-status` is 0, so feature peers keep `build-web`,
`verify` and `restart`. **No remat can succeed until this is resolved.**

## How we got here

The chain is worth stating because each step was forced by the one before:

1. A routine follow-up remat (re-pointing two re-cut layer SHAs — a behaviour no-op)
   refused: `ERROR: fork main is behind upstream/main`.
2. Syncing fork main is the documented fix and this seat's step. Upstream had moved
   **18 commits** across two rounds (`c378eb1d8`, then `7ac95e0e2` mid-work).
3. Both rounds landed and are pushed — fork main is now level with upstream.
4. The next remat then failed at the **tip-forward absorb** of the new fork main into
   the soup WIP: **91 conflicted files, 332 hunks.**

So the absorb was always pending. The sync did not create it; it made it explicit and
blocking.

## Scope

| area | conflicted files |
|---|---|
| web | 29 |
| cli | 29 |
| hub | 27 |
| shared | 3 |
| docs | 2 |
| `bun.lock` | 1 |

**332 conflict hunks total.**

## Why this was not hand-resolved on the spot

Not size — shape. The hunks look mechanical and are not. The first hub sample:

```
<<<<<<< HEAD
    const { …, onBackgroundTaskCount, … } = deps
=======
    const { …, onSessionChildExited, onBackgroundTasks, … } = deps
>>>>>>> origin/main
```

That is **a rename plus an addition in one hunk**. `onBackgroundTaskCount` →
`onBackgroundTasks` is a rename; `onSessionChildExited` is genuinely new. A naive union
keeps a destructured prop the interface no longer has — which compiles only if the type
is loose, and otherwise fails at a call site far from the edit. Multiply by 332, in a
tree where the measured hand-resolution regression rate is 4 bad resolutions in 14
(`2026-11-09-upstream-0344-sync-conflicts.md`).

The precedent is explicit and was set twice before on the same class: scout, record,
and resolve deliberately rather than at the end of a long run. Nothing is on fire — the
soup is serving.

## What was ruled out

**Dropping redundant layers.** The remat's own error suggests it:
*"or drop redundant layers that duplicate fork main"*. Upstream did land features the
fork carries as layers this round — `#2339` (FUE callouts for three unlabelled
icon-only controls) and `#2354` (Cursor status-summary emit). So this was the first
hypothesis and it is **wrong as stated**:

```
manifest layers fully contained in fork main: 0 of 82
```

No layer is wholly absorbed, so there is no trivial drop. The overlaps are partial —
upstream reimplemented things fork layers also touch — which is precisely why they
conflict instead of fast-forwarding. `driver/fue-unlabelled-controls` is still worth a
redundancy review against `#2339` (c89dc806 owns that bookkeeping), but it will not by
itself clear the absorb.

## Two traps already paid for during the sync — do not relearn them

Both rounds proved the same thing from different directions: **a clean merge is not
evidence the tree compiles.**

1. **Round 1 — a file that never conflicted stopped compiling.** Git auto-merged
   upstream's `ClaudeSteerTarget` *usage* into `cli/src/claude/claudeRemoteLauncher.ts`
   while keeping the fork's import line, which lacked the type. Three TS errors, all
   cascading from one missing `type` import, in a file with **zero** conflict markers.
2. **Round 2 — zero conflicts, still red.** Upstream bumped `remark-cjk-friendly`
   1.2.3 → 2.3.4 and imports a new subpath. A lockfile-only change produces no hunk to
   review; only `bun install` + typecheck surfaces it. (Session `2ec10899` hit the
   identical bump merging the same range into `feat/boards`, independently.)

So the verification order for this absorb is **resolve → `bun install` → typecheck →
suites**, and typecheck is not optional at the end.

## The resolution pattern that held for the CLI conflicts

Every one of the 7 sync conflicts was the same shape — upstream adding `session_job` /
`spawn_peer` to a tool list where the fork has `search_content` — and every one is a
**union, never either side**:

- `startHappyServer.ts` — keep both in the `HapiMcpToolName` union. Dropping either
  silently removes a tool from the `enabledTools` allowlist.
- `happyMcpStdioBridge.ts` — upstream's `DEFAULT_TOOL_NAMES` formatting plus the fork's
  `search_content`.
- `buildHapiMcpBridge.ts` — keep both approval entries.
- `BasePermissionHandler.ts` — upstream's comment is a superset but drops the
  `search_content` mention; restore it so the comment still describes the allowlist.
- **Peer-tools kill switch:** `search_content` stays when `HAPI_DISABLE_PEER_TOOLS=1`
  — it is read-only hub REST, not a peer tool (`buildHapiMcpBridge.ts`: *"kept under
  peer-tools disable"*). Upstream's assertions omit it; both kill-switch tests had to be
  corrected rather than letting the merge quietly narrow the fork's behaviour.

Expect the same pattern to recur through the absorb's cli/ third.

## Checks to run, and the one that would have caught the 11-05 class

1. **Symbol preservation against BOTH parents** per conflicted file — anything present
   in either parent and absent after resolution is a silent drop. This passed on all
   five sync product files and is cheap:
   ```
   comm -23 <(cat <(syms HEAD f) <(syms MERGE_HEAD f) | sort -u) <(syms WORKTREE f)
   ```
2. `bun install` then `bun typecheck` — both sync rounds needed it.
3. `bun test shared/src hub/src`. Known-pre-existing failures that reproduce on
   unmerged main and are **not** regressions: `loadServerSettings > defaults push
   settings to null`, `TitleSuggestionService > reports unavailable configuration…`.
4. `hapi-sentinel-check --auto` after the tip promotes — note it only walks manifest
   layer branches, so it is blind to anything lost from the upstream side of this merge
   (see `2026-11-09-sentinel-auto-first-sweep-triage.md`).

## State as of writing

- fork `main` = `origin/main` = level with `upstream/main` (`7ac95e0e2`), pushed.
- live soup tip `e3b1e11a8`, 88 layers, serving; dist stamped and verified.
- remat hold cleared; lease unheld; `hapi-driver-status` exits 0.
- The two re-cut layers (`ced18eaaa`, `2bf6ef8a8`) are verified to clear the fat-tip
  gate unforced and are waiting on this absorb, not on anything of their own.

---

## Correction: the session-jobs "parallel implementation" was wrong

**The operator caught this and was right.** An earlier revision of this doc claimed
upstream's `#1424` session-jobs was an *independent parallel implementation* of the
fork's, making 56% of the absorb a product decision. That was wrong, and the way it was
wrong is the point.

The test used was `git rev-list --count e5237f366 ^upstream/main` → non-zero, read as
"different implementation". But `tiann/hapi` **squash-merges**, so a fork commit never
appears as an upstream ancestor even when the code is byte-identical. Both commits are
authored by HeavyGee: `ee73f3a84` is **our own PR**, merged upstream 2026-11-10 00:37Z.

**A provenance check was used to answer a content question** — the same
ancestry-vs-presence error this whole plan set exists to document, committed while
documenting it.

The content comparison says the opposite of the ancestry one:

| | soup | fork main (= upstream, post-review) |
|---|---|---|
| `hub/src/store/sessionJobs.ts` | 350 lines | **579 lines** |
| exported symbols | — | **+11** (terminal-wake machinery, richer result types) |

Upstream's version is a **superset**: our work matured through review. The one
soup-only symbol, `ensureSessionJobWakeColumns`, is a runtime migration helper made
obsolete by main carrying `wake_on_terminal` / `wake_prompt` / `wake_emitted_run_id`
first-class in the schema. Every `hapi job` flag this seat depends on
(`--progress unknown|fraction|until`, `--wake-on-terminal`, `--wake-prompt`) is present
in main's `cli/src/commands/job.ts`.

**So there is no product decision.** Session-jobs resolves as "take main" — accept our
own reviewed work back.

## Where the absorb actually stands

**28 of 91 resolved**, by two rules that were validated rather than assumed:

1. **`bun.lock` — restore the pre-conflict lockfile, never delete-and-reinstall.**
   Straight from session `2ec10899`, who did this wrong once on `#2147` and caught it
   in their own cold review: a bare `bun install` re-resolved the whole graph against
   loose semver and floated 44+ unrelated packages to new majors (uuid 11→14, hono
   4.11→4.13), which broke `permissions.test.ts`. **That also retracts an earlier
   "hub flake" report — `permissions.test.ts` was never flaky, it was a dependency
   float. Do not quarantine it.**
2. **Take main's side only where it provably drops nothing.** Per file, compare the
   identifier sets of stage 2 (ours) and stage 3 (theirs); resolve as theirs only when
   `comm -23 ours theirs` is empty. 10 purely-session-jobs files plus 17 others passed;
   all 27 verified clean afterwards.

Lists are committed so this is reproducible in one scripted pass, not re-work:
`scripts/tooling/absorb/2026-11-10-safe-theirs.txt`,
`scripts/tooling/absorb/2026-11-10-needs-union.txt`.

**63 files remain and need genuine per-hunk union**, because the soup is main *plus* 88
layers — taking main there would delete fork features wholesale. Worst cases by fork
identifiers at risk: `SessionList.tsx` (665), `en.ts` (409), `shared/src/schemas.ts`
(404), `syncEngine.ts` (396).

Inherit rather than rediscover: `2ec10899` already absorbed this upstream range on two
branches and found a real bug in `sessionCache.ts` — upstream's second, **unprotected**
`mergeSessionMetadata()` call bypasses the fork's `ExternalRefsMergeCapExceededError`
handling, reintroducing the hard throw that `mergeSessionHistory`'s carve-out exists to
avoid. Wrap it in the same try/catch as the function's other protected call site.
