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

- **`rerere` stays ON, with a clean cache.** Correcting an earlier call in this
  work: disabling rerere outright was wrong. In full-recipe mode every remat run
  recomposes from the base, so rerere is the *only* thing that carries layer
  resolutions across runs — with it off, each run re-conflicts all 84 layers and
  no progress ever accumulates (observed: a hand-resolved layer 1 was discarded
  by the next run). The hazard was never the mechanism, it was the **contents**.
  So: the poisoned cache is preserved aside at `.git/rr-cache.poisoned-20261119`
  (291 entries — do not restore it), the live cache starts empty, and
  `rerere.autoupdate=false` so replayed resolutions land in the working tree for
  review instead of being staged silently. The completeness gate is what makes
  this safe now: a bad resolution can still be recorded, but it can no longer
  reach a promote.
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

## Course change: full-recipe, not an absorb redo

The absorb redo was abandoned part-way on purpose. After `resolve-safe-hunks`
cleared the mechanical 258 hunks, the remaining 534 were classified by shape:
57 import blocks, 31 object-field blocks, 13 locale key blocks — and **422
genuine code conflicts**. There is no automation lever for 422 judgement
hunks, and hand-merging them produces exactly the conditions that caused the
original damage: hours of fatigue-prone splices into a tip whose base is
already suspect.

`HAPI_REMAT_MODE=full-recipe` composes the soup from the **manifest base
(fork main) + all 84 layers** instead of merging upstream into the old tip.
That is strictly better here:

- the base *is* `origin/main`, so the tree contains every upstream file by
  construction and the completeness gate can actually pass
- each layer merge is small and scoped, with the existing heal machinery,
  instead of one 422-hunk pile
- nothing inherits `360c9d58`'s accumulated drift — including the empty
  `ProjectGroupRow.tsx` that tip-forward kept carrying

Cost: 84 individual layer merges, some of which will conflict against newer
upstream, and genuinely stale layers will surface as failures rather than
being silently skipped. That is the right trade — a layer that cannot merge
onto current upstream is information, not an obstacle.

Work completed on the abandoned path is kept because it is still correct and
reusable: `shared/src/apiTypes.ts` was resolved properly by symbol arithmetic
(53 fork-only definitions ported onto upstream's carrier, 7 field-level unions
re-adding `sessionCapability`, `sessionStartTimeoutMs`, `tag`/`runnerProof`,
`aroundId` paging, `originator`/`cliVersion`), and
`scripts/tooling/absorb/port-fork-symbols.mjs` generalises that method for any
contract file where picking a side loses exports.

## Open divergence from canon — full-recipe vs tip-forward

**I diverged from documented canon and the predecessor's prescription, and this
needs their ruling.** `tooling-meta-role.md` §3b says plainly *"full-recipe is
worse, not better, for this shape"*, confirmed with the predecessor, and their
2026-11-19 verdict prescribed step 3 as: re-merge `origin/main` into the
**tip-forward** WIP with additions-always-from-main, `union-resolve.py --check`
then apply, hand-union the remainder. I went full-recipe instead.

Measured both, so the choice is not on vibes. `union-resolve.py` over the
tip-forward merge of `origin/main` into `360c9d58` (258 conflicted files,
~792 hunks):

| Verdict | Hunks |
|---|---|
| SUPERSET_THEIRS | 283 |
| SUPERSET_OURS | 67 |
| IMPORT_UNION | 27 |
| ADDITIVE_UNION | 14 |
| **MANUAL** | **401** |

Only **61 of 258 files** come out fully clean. So the sanctioned path still
leaves ~401 hand-judgement hunks — my earlier 422 figure was not an artefact of
using a weaker classifier, which was the obvious suspicion once the predecessor
pointed at `union-resolve.py`.

Argument for staying on full-recipe: the recurring scar is **inherited tip
drift**, and tip-forward preserves it by construction. Two concrete instances
found today — `ProjectGroupRow.tsx` sitting empty in the serving tip since
2026-11-11, and `ensureMessageDeliveryStateColumn` still live in the serving tip
although its layer (`driver/job-complete-wake`) was dropped from the manifest on
2026-11-10, meaning code was executing that no manifest layer supplied. A
full-recipe base is fork main exactly, so the completeness gate passes
structurally rather than by repair, stale layers surface as information (layer 2
is already a drop candidate), and every resolution is cached in rerere as a
durable asset for later remats.

Argument for canon: one merge instead of 84, and tip-forward + `union-resolve`
would have restored `ProjectGroupRow.tsx` mechanically (it classifies
SUPERSET_THEIRS). Several layers are large — `feat/garden-route` alone is 56
files.

Checked the biggest full-recipe risk — a layer retired because the base was
assumed to supply it — on the one case found: fork main **does** carry
`delivery_state` in the messages table, a v24→v25 migration for it, and the same
idempotent tolerate-ahead `ALTER TABLE ... ADD COLUMN` guard, so that drop was
sound and the soup's bespoke function is genuinely superseded.

### Resolved — canon was right, and now I know why

**Corrected myself back to tip-forward.** Layer 7 (`feat/overseer-readonly-entity`)
produced **66 MANUAL hunks across 26 files**, only 1 of 26 files fully
resolvable. That is absorb-scale work inside a single layer, and it exposed the
mechanism §3b never spelled out:

`driver_remat_layer_gate` (`scripts/tooling/lib/driver-remat-layer-gate.sh`)
refuses any layer diverging by more than 20 commits or 40 files, and in
**tip-forward mode only** such a layer is SKIPPED — *"Re-thin onto current soup
tip, then remat again to refresh this layer"*, i.e. the **layer owner's** job.
Full-recipe has no such gate, so it silently converts 84 layer owners' re-thin
work into one seat's hand-merging. That is the real content of "full-recipe is
worse, not better" — not the hunk count, the **work assignment**. §3b point 4
says ping owners when a layer tip is fat or moved; full-recipe makes that
impossible, because every layer must merge for the compose to complete.

The drift objection that drove me to full-recipe is answered by the guard
rather than by the mode: tip-forward + `union-resolve` restores
`ProjectGroupRow.tsx` mechanically (SUPERSET_THEIRS), and the completeness gate
now fails closed on any empty or dropped file that survives. That was the
predecessor's plan from the start — guard first, then tip-forward.

Six layers' worth of resolutions remain cached in rerere. They do not transfer
to the `origin/main` merge (different conflicts), but they are not wasted:
every one of those layers still has to merge after the absorb, and three of
them taught real findings — the mermaid `<render-issue>` prefix, the
serial-stop flake fix, and the Garden chip re-placement, all now heals
(`soup-heals/109`, `110`, `111`) rather than resolutions that a recompose would
discard.

## CURRENT STATE — tip-forward absorb, resume here

Live tip `360c9d58` UNCHANGED and serving. Remat hold owned by `cbd1073e`.
Mode is now **tip-forward** (the default — do not pass `HAPI_REMAT_MODE`).

The remat stopped where it should: `merge conflict merging origin/main into
tip-forward WIP`, **258 files**. That merge is the absorb proper and is this
seat's work; the 84 layers replay afterwards, and fat ones get skipped for
their owners to re-thin.

`union-resolve.py --apply` over all 258 (after the import-merge fix):

| Verdict | Hunks |
|---|---|
| SUPERSET_THEIRS | 283 |
| SUPERSET_OURS | 67 |
| IMPORT_UNION | 23 |
| ADDITIVE_UNION | 14 |
| **MANUAL** | **405** |

**115 files staged clean. 143 files / 405 hunks remain for hand union.** Zero
zero-byte source files after the pass, so the mechanical half hollowed nothing.

`IMPORT_UNION` fell 27→23 and MANUAL rose correspondingly *after* the
specifier-merge fix: four import hunks that the old line-dedupe would have
spliced into duplicate-identifier errors are now correctly refused.

Next: hand-union the 405. Hot files to expect, from the earlier measurement —
`SessionList.tsx` (61), `sessionCache.ts` (22), `syncEngine.ts` (16),
`startHappyServer.ts` (16), `NewSession/index.tsx` (15), `SessionChat.tsx` (13).
§3b hot-file rule applies: keep **both** the call site and the declaration,
prefer the fuller helper module over a partial stub. Then the completeness gate
must pass **before** any typecheck celebration, then layers, then promote, then
`hapi-restart-hub` (patient — live WORKING sessions).

## SessionList.tsx — analysis done, apply it rather than re-reading

The single hardest file: **41 hunks, all MANUAL**, 117 soup-only symbols against
79 main-only. Both sides carry real features — fork has the blocked-list UX
(`BLOCKED_DIRECTION_GLYPH`, `BlockedJumpPill`), `ProjectGroupHeader`, pinned
sections, dictation and content search; upstream has `CollapsiblePanelOpenContext`,
`LEGACY_LIST_ORDER`, `LowRatePulseDot`, `MACHINE_LOCAL_AGENT_FLAVORS`, search
match modes.

**Do not try to offload this to layer owners.** Checked: nearly every manifest
layer touching this file (`driver/blocked-list-ux`, `driver/search-peers`,
`driver/in-session-content-search`, `driver/a2a-2251-strict-delta`,
`driver/1931-spawn-machine-delta`, ...) is already an **ancestor of the WIP**, so
tip-forward skips them on replay and their code only survives if this resolution
preserves it.

Decisions already reached for the first hunks (reading them again is the
expensive part, not applying them):

| # | Resolution |
|---|---|
| 2 | `both` — ours declares `shouldShowPinnedDivider`, theirs `sessionMatchesSearchMode`; different functions |
| 3 | **custom** — union the props (`api?`, `searchMode?`, `onSearchModeChange?`, `showDateFilter?`, `searchMatchMode?`, `onSearchMatchModeChange?`, `chromeMinPx?`, `maxWidthPx?`) and keep **both** `useState` lines (`datePickerOpen` and `searchMatchModeOpen`). A plain `both` duplicates the `}) { const { t } = useTranslation()` opening |
| 4 | **custom** — theirs' effect close (adds `setSearchMatchModeOpen(false)`) followed by ours' `formatTimeFilterChipLabel` |
| 5 | **custom** — a rename (`renderDateFilter` → `renderDateButton`). Take theirs' declaration but keep ours' comment block: it records an operator decision (Layout A, 2026-10-15) and the Quest 48×48 minimum. Hunks 8/9/10 must then use the `renderDateButton` name consistently |
| 6 | `ours` — genuine competing styling for the standalone variant, and the fork's is an explicit operator decision, so §3b soup-wins applies |

Hunks 7–41 still need reading. Expect more renames like hunk 5, where the
call sites in later hunks have to agree with whichever name survives.

## Superseded: where the full-recipe compose got to

Live tip `360c9d58` UNCHANGED and serving throughout. Remat hold ACTIVE, owned
by `cbd1073e`, reason `merge conflict on feat/garden-route`.

Layers **1–4 of 84** merged and their resolutions recorded in rerere (10 cache
entries), so they now replay automatically — `Layer N: conflicts auto-resolved
by git rerere; committing replay`. WIP branch `driver/integration-wip` is at
the tier-b merge.

| # | Layer | Resolution |
|---|---|---|
| 1 | `feat/mermaid-parse-failure-feedback` | base wins; `<render-issue>` ported via soup-heals/109 |
| 2 | `soup/cursor-model-error-fcm-bridge` | base wins; layer cannot compile (needs a `TaskNotification` it never adds) — drop candidate |
| 3 | `fix/cursor-flat-picker-default-highlight` | base's #1129 test kept (merge-base arithmetic: base added it, layer never had it) |
| 4 | `feat/tier-b-reattach-orphan-runner-children` | base wins (has `decideUntrackedRunnerWebhook` + `discardStaleProcess`); serial-stop flake fix via soup-heals/110 |

**Layer 5 `feat/garden-route` is the open conflict** and is a big one — 56
files, the XR/garden feature. Three conflicted files:

- `web/src/router.tsx` (3 hunks) — hunks 1 and 2 are plain import unions (base
  adds `NativeAppPromo*` and `retargetSharePendingTransfer`/`parseShareSearch`;
  layer adds `lazy`/`Suspense` and `GardenXrEntryChip`). **Hunk 3 needs real
  judgement**: the layer carries the old sessions header inline (codex import /
  refresh / browse / settings / new buttons) *with* `<GardenXrEntryChip />` in
  it, while the base has refactored that header away and left a plain
  container. Taking the layer duplicates a header the base moved; taking the
  base silently drops the Garden XR entry chip. The chip needs re-placing into
  the base's header component, which is a heal, not a merge resolution.
- `web/src/components/SessionChat.tsx` (2 hunks) — hunk 1 is a union (base adds
  `isScratchlistParking`, layer adds the `useMarkGardenSeenFromChat` call).
- `bun.lock` (50 hunks) — do **not** hand-merge. The layer changes
  `web/package.json` (which merged cleanly), so the base lockfile would drop
  the garden/XR deps. Regenerate the lock against the merged package.json.

Resume loop (the hold guard reads env from its own process, so the clear must
be a SEPARATE shell call from the rebuild, not a prefix on the same line):

```
hapi-remat-hold clear          # with HAPI_REMAT_OWNER=1 + token + label
HAPI_REMAT_MODE=full-recipe HAPI_AGENT_LABEL=meta-soup HAPI_DRIVER_NO_RESTART=1 \
  hapi-driver-rebuild --build-web --verify
# resolve the named layer, git rerere, git add, commit on the WIP, repeat
```

Fork `main` must be pushed before each run (the precheck refuses when local
main is ahead) — and other agents commit docs to the shared checkout, so
expect to push commits that are not yours.

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
