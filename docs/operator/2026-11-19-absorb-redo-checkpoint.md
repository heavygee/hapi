# Absorb redo — checkpoint (2026-11-19)

Owner: tooling/meta seat (`cbd1073e`). Remat hold is **set and owned by this
seat**. Live tip `360c9d58` is UNCHANGED and serving — nothing is broken for
users, and nothing has been promoted.

## Why the first absorb is being redone

The 110-commit absorb (`47e506c4f`, promoted-ready tip `a5cf1b95f`) composed a
tip that was **missing 209 of the 293 files upstream had added** — 163 absent
outright, 46 present but zero bytes — plus **61 exported symbols dropped from
`shared/src/apiTypes.ts`**, `getLiveToolWork` off `MessageStore`,
`autoBridgeTransientModelErrors` off `Settings`, and
`DEFAULT_PR_CHIP_DISPLAY`/`mergePrChipDisplayProfile` off `@hapi/protocol`.

The full gate read **EXIT=0** on that tree: hub 2357 pass / 0 fail, web 4776,
shared 670, relay 118, cli 5005, typecheck clean in every package. It passed
because **each lost implementation file had its test file emptied or dropped in
the same resolution pass**. Nothing was left to fail. `tsc` is blind here too:
an empty `.ts` is a legal module, and a dropped file whose only importer also
went missing is just absent.

Two causes, both mine:

1. **"Soup wins overlapping edits" applied to upstream additions.** An addition
   has no overlapping lines, so soup-wins is not a tie-break there — it is
   silent deletion. A plain 3-way merge would have been correct: git keeps both
   sides' non-overlapping additions by itself. The damage came from the bulk
   manual passes layered on top of it.
2. **`rerere` replayed the damage.** `rerere.enabled` was `true` with 291 cached
   resolutions. On the re-merge it silently auto-staged **191 of 258** conflicted
   files from that cache, reproducing the deletions without printing anything
   beyond `Staged <file> using previous resolution`. This is why
   `b97537bd1`-era damage kept resurfacing across later merges.

Not a first offence: `b97537bd1` ("fix(absorb): make the merged tree compile —
180 errors to zero", 2026-11-11) emptied 15 files and created
`web/src/components/ProjectGroupRow.tsx` as empty (additions 0, deletions 0).
The rest were refilled later; that one was not, so the sidebar project-group
right-click / long-press menu (#881, #2357) is **dead on the serving tip today**
with no importers left. Clearing compile errors by deleting content removes the
error and the feature together.

## Guards that now exist (so this cannot ship green again)

- `scripts/tooling/hapi-soup-base-completeness-check.mjs` (+ `.test.sh`, 7 cases)
  — wired into `hapi-driver-rebuild.sh` **before promote, always**, not only
  under `--verify`. Fails on any zero-byte tracked source file (no allowlist —
  there is no legitimate empty `.ts`), any base file absent from the tip, any
  export lost from a cross-package contract file. Absence and symbol checks only
  apply when the base is an **ancestor** of the tip, because a pre-absorb tip is
  legitimately missing everything the base gained since; the first draft failed
  the live tip for exactly that reason and test 3 pins it. Landed `d94bb048e`.
- `scripts/tooling/absorb/resolve-safe-hunks.mjs` (+ `.test.sh`, 4 cases) —
  conservative hunk resolver. Resolves ONLY provable supersets and pure
  reorderings; leaves everything needing judgement conflicted. Tested against
  the brace/comma corruption shape and against malformed regions.

## Hard rules for the remainder of this redo

- **`rerere` stays off.** Repo config now `rerere.enabled=false`; the poisoned
  cache is preserved at `.git/rr-cache.poisoned-20261119` (291 entries). Do not
  restore it. If a merge prints `using previous resolution`, stop.
- **Never empty a file** to clear a compile error, and never delete a file
  present on either side. If a restored file does not compile, its dependencies
  were lost too — fix those, do not delete the file.
- **Upstream additions are always taken.** Soup wins only genuine same-line
  conflicts.
- **A green gate does not clear this work** — the gate was green on the broken
  tree. Completeness gate + typecheck + gate, in that order.
- Taking one side of a file pulls in that side's view of its **dependencies**:
  `cursorAcpRemoteLauncher.ts` looked lossless per-symbol and produced 58 errors
  because upstream's launcher needs upstream's `MessageQueue2`,
  `cursorModelErrorBridge` and classifier. Per-file symbol diffs cannot see
  cross-module coupling.

## State as of this checkpoint

Worktree: `~/coding/hapi/worktrees/driver-remat`, branch `driver/integration-wip`.

- Reset to pre-absorb live tip `360c9d58`, then `git merge origin/main` with
  rerere disabled: **258 conflicted files / 792 hunks**, 1108 files auto-merged
  by true 3-way (correct by construction — do not touch them).
- `resolve-safe-hunks --apply` cleared **258 hunks** (256 superset, 2 reorder),
  emptied nothing. **168 files / 534 hunks remain for judgement.**
- Mid-merge. Nothing committed on the WIP branch yet.

Recovery branches:

| Branch | What it is |
|---|---|
| `soup/broken-absorb-20261119` | the bad tip `a5cf1b95f`, kept as evidence |
| `soup/restore-attempt-20261119` | file-only restore of the 209 (577 tsc errors — proof that restoring files without their deps does not work) |

## Remaining work

1. Resolve the 534 judgement hunks (168 files). Largest: `SessionList.tsx` 61,
   `sessionCache.ts` 22, `syncEngine.ts` 16, `cursorAgentMessageClassifier.test.ts`
   16, `startHappyServer.ts` 16, `bun.lock` 16.
2. Completeness gate must pass, then typecheck, then the full gate.
3. Commit the absorb, then resume the remat to replay the 84 layers.
4. Compose the two queued layers: `3003cd2e` (#271 `agentTitlePolicy` sentinel in
   Settings) and `b0640d2b` (`consumer:verify --expect-tag v0.23.1`); ping both
   owners with the compose SHA.
5. `hapi-restart-hub` (patient drain — live WORKING sessions; never
   `sudo systemctl restart`).
6. Only then hand the post-absorb SHA to the umbrella (`c89dc806`) for the
   #1717 / #2520 re-thin. It is deliberately withheld until the completeness
   gate passes.
7. Restore `ProjectGroupRow.tsx` **and its importer** together (the redo should
   do this naturally; verify it, since the serving tip lost the feature).
8. Stale comment: `hub/src/store/index.ts:165` claims "Soup tip keeps
   SCHEMA_VERSION=23"; actual is **35**. Fix while in there.
