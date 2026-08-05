# Remat tip-forward probe (T vs F)

> **For Claude:** findings doc + recommended rewrite tasks. Probe only - no soup tip change.

**Goal:** Falsify tip-forward remat vs full-recipe remat with measurements; go/no-go on rewriting `hapi-driver-rebuild` remat.

**Architecture:** Full-recipe remat (`driver_remat_prepare` hard-resets WIP to `upstream/main`, merges all manifest layers, applies `soup-heals/`). Tip-forward starts from last green soup tip, merges `upstream/main` only if needed, then merges only non-ancestor layer tips.

**Tech Stack:** git `merge-tree --write-tree`, throwaway worktrees under `worktrees/`, Vitest/tsc via `bun typecheck`.

**Probe date:** 2026-08-05  
**Live tip (read-only):** `2880fe3da` (`driver` HEAD; includes tip-forwarded `#1384`)  
**upstream/main:** `0a037c981` (already ancestor of tip; 0 commits behind)  
**Manifest:** 29 active layers; 40 heals + 11 parked  
**Artifacts:** `docs/plans/artifacts/remat-tip-forward-probe-2026-08-05/`  
**Probe script:** `scripts/tooling/probe-remat-tip-forward.sh`

---

## Verdict

**GO on tip-forward as the default remat path**, with a mandatory thin/union-tip gate before absorbing moved layer tips.

Kill-criteria scorecard (Meta cold-read):

| Criterion | Result | Call |
|---|---|---|
| T conflicts ≤ 25% of F **and** typecheck green without heals | **14.9%** (17/114); tip `bun typecheck` **rc=0 / 0 TS errors** without applying heals | **PASS → rewrite remat to tip-forward** |
| T still needs >10 tip-file restores | Absorbing the 3 non-ancestor layer tips → **17** conflict files (real `git merge` matches merge-tree). Heal inventory on tip: **23 no-op**, **0 real deltas**, 10 applyfail, 7 nocheck | **PARTIAL → union/thin-tip gate before tip-forward layer refresh** |
| T wall-clock not clearly better | merge-tree wall **241ms vs 911ms** (T = 26% of F); real F also pays 29 checkouts + heal loop | **PASS → not a layer-budget-first problem** |

Practice already matches the bet: Meta tip-forwarded `#1384` (`fbf19aac4`) onto green tip → `2880fe3da` clean. Full rebuild would have reset that tip into yesterday's minefield.

---

## Measurements

### Setup

- **T:** start `2880fe3da`; skip upstream (ancestor); merge only non-ancestor layer tips.
- **F:** start `upstream/main`; merge all 29 layers sequentially via `git merge-tree --write-tree` (continue through conflicts on synthetic commits to accumulate unique conflict surface; **no rerere** - lower bound on pain, not a claim that remat with rerere is identical).
- Neither path touched `driver/` or promoted.

### Conflict / time

| | F (full-recipe) | T (tip-forward) |
|---|---|---|
| Layers attempted | 29 | 3 (26 skipped as ancestors) |
| Clean merge steps | 9 | 0 |
| Conflict steps | **20** | **3** |
| Unique conflict files | **114** | **17** |
| First failure | L1 `feat/mermaid-parse-failure-feedback` | L6 `feat/agent-session-import-picker` |
| merge-tree wall | 911 ms | 241 ms |

**T/F conflict ratio = 14.9%** (≤ 25% gate).

Non-ancestor layers at probe time:

1. `feat/agent-session-import-picker` - 1 conflict file
2. `feat/cross-flavor-inline-images` - 3 conflict files
3. `fix/hub-runner-version-governance` - **14** conflict files (fat tip: **97** commits ahead of soup tip / **95** files vs merge-base)

Real `git merge` + abort in throwaway WT reproduced the same **17** unique paths.

### Typecheck / critical files

- Tip WT after `bun install`: `bun typecheck` → **rc=0**, **0 `error TS`**, ~17s.
- Critical files present on tip: `hub/src/store/settingsStore.ts`, `router.tsx`, `client.ts`, `SessionHeader.tsx` (the "missing settingsStore" symptom is **not** true of current tip - that was a prior broken full-remat corpse).

### Heal relevance on tip

| Class | Count | Meaning |
|---|---|---|
| NOOP (apply -3, zero diff) | **23** | Tip already has equivalent content |
| APPLYFAIL (`--check` ok, apply fails) | 10 | Stale 3-way / would `heal_fail` under current rebuild |
| NOCHECK | 7 | Does not apply |
| Parked | 11 | Already sidelined |

**Heals are not carrying tip-forward.** Replaying the heal directory on a tip-forward remat is mostly theater; 10 would hard-fail the rebuild. Prune/inventory belongs in the rewrite.

---

## What this falsifies

1. **"We must full-recipe remat to stay honest"** - F without rerere dies at layer 1 and accumulates 114 conflict paths. Tip is already a union that F cannot cheaply reproduce.
2. **"Tip-forward alone clears heal debt"** - No. Tip is typecheck-green and heal-no-op; heal debt is inventory rot + prior full-remat scar tissue, not something tip-forward magically deletes. Rewrite must **stop treating heals as the shadow merge**.
3. **"Tip-forward always cleanly absorbs moved layer tips"** - False for fat tips (`fix/hub-runner-version-governance`). Tip-forward of *new thin layers* (the `#1384` pattern) is the clean case; tip-forward of *rebased fat layer tips* needs a gate.

---

## Friction mode (steelman the opposite)

**Opposite case:** tip-forward makes soup unreproducible - the only durable artifact becomes "whatever green tip we happened to have," and disaster recovery (wipe tip, remat from recipe) stays impossible.

**Risks:**

- Tip drifts from `upstream + layers` recipe; new operators cannot rematerialize from manifest alone.
- Silent skip of layers that look like ancestors by SHA but lost content to an earlier bad resolve.
- Fat layer tips keep bit-rotting because tip-forward never force-refreshes them.

**Kill-criteria for tip-forward after rewrite ships:**

1. A scheduled/manual **recipe audit** (merge-tree F in a throwaway WT, or content hash of critical paths vs layer tips) fails for >2 consecutive remats → reopen full-recipe path.
2. Tip-forward promotes a tip that is missing a manifest layer's unique product files (union check) → hard fail, no promote.
3. Layer tip is >N unique non-merge commits ahead of tip **or** touches >M files vs merge-base → refuse tip-forward absorb; require thin rebase first.

Cheapest falsification after rewrite: one dogfood remat that only adds a thin new layer (expect 0 conflicts), plus one deliberate fat-tip absorb attempt (expect gate refuse).

---

## Recommended next code change

### Task 1: Tip-forward remat mode in rebuild

**Files:**
- Modify: `scripts/tooling/lib/driver-remat-atomic.sh` (`driver_remat_prepare`)
- Modify: `scripts/tooling/hapi-driver-rebuild.sh` (layer loop)
- Test: `scripts/tooling/lib/driver-remat-atomic.test.sh`

**Step 1:** Add `driver_remat_prepare_from_tip` that checks out WIP at `PREV_TIP` (not `base_ref`), still in remat WT only.

**Step 2:** In rebuild loop: if `upstream/main` not ancestor of WIP, merge it first; then for each manifest layer, `merge-base --is-ancestor` → skip; else merge.

**Step 3:** Default tip-forward when live tip exists and `HAPI_REMAT_MODE` unset; keep `HAPI_REMAT_MODE=full-recipe` escape hatch for Meta-owned disaster remats.

**Step 4:** Preserve atomic promote/hold/restore behavior unchanged.

### Task 2: Union / thin-tip gate (before absorbing non-ancestors)

**Files:**
- Create: `scripts/tooling/lib/driver-remat-layer-gate.sh`
- Modify: `hapi-driver-rebuild.sh` (call gate before merge)

**Step 1:** Gate refuses layer tip if `rev-list --count --no-merges TIP..LAYER > 20` **or** `diff --name-only $(merge-base TIP LAYER)..LAYER | wc -l > 40` (tune from this probe: governance was 97 / 95).

**Step 2:** Error message points layer owner at re-thin onto tip/upstream; sets remat hold only if Meta forced `--absorb-fat`.

**Step 3:** Optional content union check: critical paths from layer tip must exist in result tree before promote.

### Task 3: Heal inventory prune

**Files:**
- Modify: heal apply loop in `hapi-driver-rebuild.sh`
- Modify: `scripts/tooling/soup-heals/` (park no-ops / applyfails)

**Step 1:** Before apply, skip patches that are no-ops on WIP (`apply -3` + empty diff).

**Step 2:** Treat applyfail-after-check as skip+warn in tip-forward mode (do not `heal_fail` the whole remat); full-recipe mode keeps fail-closed.

**Step 3:** Park the 10 applyfail + confirm 23 no-ops in a one-shot Meta inventory commit (separate from product remat).

### Task 4: Keep probe harness

**Files:**
- Keep: `scripts/tooling/probe-remat-tip-forward.sh`

**Step 1:** Wire as `hapi-remat-probe` optional Meta preflight before owned remats.

**Step 2:** Fail CI/local advisory if T/F unique-conflict ratio > 0.25 on current tip+manifest (signals tip-forward losing its advantage).

---

## Explicit non-goals (this probe)

- No `hapi-driver-rebuild`, no promote, no stack-switch, no remat-hold clear.
- No live `driver/` edits.
- No upstream PR.

---

## Parent ping payload (Meta `05d9f0f2`)

Verdict: **GO tip-forward remat rewrite** (T conflicts 17 vs F 114 = 14.9%; tip typecheck green w/o heals; wall clearly better).  
Caveat: **union/thin-tip gate required** - 3 moved layer tips still conflict (17 files), governance alone is a 97-commit fat tip.  
Heals: 23 no-op on tip, 10 would fail apply - prune, do not shadow-merge.  
Next code: tip-forward default in `driver_remat_prepare` + layer gate + heal skip/prune; keep `HAPI_REMAT_MODE=full-recipe` escape hatch.
