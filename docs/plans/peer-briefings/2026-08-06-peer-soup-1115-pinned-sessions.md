# Peer briefing: soup-promote upstream #1115 (persistent pinned sessions)

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/web-pinned-sessions-soup`  
**Branch:** `driver/web-pinned-sessions` (soup **union tip**, not a competing upstream PR)  
**Upstream PR (do not rewrite / do not open a rival PR):** https://github.com/tiann/hapi/pull/1115 (@techotaku39)  
**Issue:** https://github.com/tiann/hapi/issues/532  

## Operator ask

Someone else already built per-session Pin (context menu). Operator wants it on **driver soup `:3006`** for inbox dogfood. Settings "Pin in-progress sessions" is a **different** feature - ignore for this.

## Why you cannot just add `pr: 1115`

Orchestrator trial-merged `techotaku39/feat/web-pinned-sessions` (`41a0afa43`) onto current `driver` tip (`7261e5e64`):

1. **Content conflicts** in: `hub/src/store/index.ts`, `migration-v18.test.ts`, `sessions.ts` / tests, `SessionActionMenu.tsx`, `SessionHeader.tsx`, `SessionList.tsx`, `useSessionActions.ts`.
2. **SCHEMA collision (kill-criterion):** both claim `SCHEMA_VERSION = 20` for **different** migrations:
   - **Soup/driver today:** `migrateFromV19ToV20` = usage_events reindex / scan-state clear (`tiann/hapi#1359` lineage). Live DB `user_version` is already **20**.
   - **PR #1115:** `migrateFromV19ToV20` = `ALTER TABLE sessions ADD COLUMN pinned …`.

Blind merge would either drop usage v20, never apply `pinned` on an already-v20 DB, or both. **Do not** add the raw PR layer to the manifest and hope.

Local ref already fetched: `refs/heads/techotaku39/feat/web-pinned-sessions` (same as `refs/remotes/techotaku39/feat/web-pinned-sessions`). `pr:` manifest resolver only fetches `origin/` - use a **local branch** layer.

## Your job (soup union)

1. Build `driver/web-pinned-sessions` that merges cleanly onto **current driver tip** (or remat WIP equivalent): take #1115 pin behavior (hub column + `PUT /api/sessions/:id/pin` + sidebar/header Pin/Unpin + list ordering).
2. **Remap pin migration to v21** (or next free step): keep soup's existing v20 usage migration intact; add idempotent `pinned` column migration as **v21**; bump `SCHEMA_VERSION` to 21; add/adjust migration tests.
3. Resolve the listed content conflicts in favor of: pin feature + current soup behavior (In progress optional, Idle changes, header metadata, etc.). Prefer small heals; `scripts/tooling/soup-heals/*.patch` if that is the estate pattern for remat.
4. Trial `git merge-tree --write-tree --messages "$(git -C ~/coding/hapi/driver rev-parse HEAD)" driver/web-pinned-sessions` → must be **clean**.
5. Add layer to **`~/.config/hapi/driver-manifest.yaml`** *and* mirror `config/driver-manifest.yaml` (keep in sync; commit mirror utensil):
   ```yaml
   - branch: driver/web-pinned-sessions
     # SOUP 2026-08-06: upstream #1115 pin sessions; schema pin→v21 (soup v20=usage)
   ```
6. `hapi-driver-status --quiet` → `hapi-driver-rebuild --build-web --verify` → `hapi-verify-web-dist`. Hub/cli changed → `hapi-restart-hub` (patient). Confirm DB migrates 20→21 and Pin appears in session context menu on `:3006`.
7. PNG / `display_image` proof: right-click → Pin; pinned session stays put.
8. **Do not** open an upstream PR that races #1115. Optional: polite comment on #1115 noting soup remapped pin to v21 because upstream/main may already have usage as v20 - only if accurate at comment time.

## Intake ownership

| Step | Status |
|------|--------|
| Archaeology / conflict discovery | DONE (orchestrator) |
| Union tip + schema v21 remap | **YOU** |
| Manifest + rebuild + dogfood proof | **YOU** |
| Competing upstream PR | **NO** |

Hard rules: no agent stack-switch; no hand-edit inside `driver/` except via rebuild; commit tooling dirt same turn; never merge `tiann/hapi`.
