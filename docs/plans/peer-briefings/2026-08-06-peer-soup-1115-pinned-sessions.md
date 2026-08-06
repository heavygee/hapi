# Peer briefing: soup-promote upstream #1115 (persistent pinned sessions)

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/web-pinned-sessions-soup`  
**Branch:** `driver/web-pinned-sessions` (soup **union tip**, not a competing upstream PR)  
**Upstream PR (do not rewrite / do not open a rival PR):** https://github.com/tiann/hapi/pull/1115 (@techotaku39)  
**Issue:** https://github.com/tiann/hapi/issues/532  

## Operator ask

Someone else already built per-session Pin (context menu). Operator wants it on **driver soup `:3006`** for inbox dogfood. Settings "Pin in-progress sessions" is a **different** feature - ignore for this.

## Why you cannot just add `pr: 1115`

Orchestrator trial-merged `techotaku39/feat/web-pinned-sessions` (`41a0afa43`) onto then-current `driver` tip:

1. **Content conflicts** in: `hub/src/store/index.ts`, migration tests, `sessions.ts` / tests, `SessionActionMenu.tsx`, `SessionHeader.tsx`, `SessionList.tsx`, `useSessionActions.ts`.
2. **SCHEMA collision (kill-criterion):** #1115 claimed `SCHEMA_VERSION = 20` for `pinned` while soup already used v20 for usage reindex (#1359). Mid-promote, tip-forward remat also absorbed upstream #1390 which took **v21** for cache usage semantics. Pin therefore lands as **v22** on the union tip (not v21).

Blind merge of raw #1115 would drop usage migrations and/or never apply `pinned` on an already-advanced DB. **Do not** add the raw PR layer to the manifest and hope.

Local ref: `techotaku39/feat/web-pinned-sessions` @ `41a0afa43`. Use a **local/origin branch** layer (`pr:` only fetches `origin/`).

## Progress (2026-08-06 peer)

| Step | Status |
|------|--------|
| Union tip `driver/web-pinned-sessions` @ `9cb1e1bcd` | **DONE** — based on remat tip-forward `1964a3d67`; pin→**v22**; merge-tree clean vs driver |
| Manifest layer (mirror + `~/.config`) | **DONE** — utensil commits `c04ae067a` / `8f2c1c964` |
| `hapi-driver-rebuild --build-web --verify` | **BLOCKED** — remat-hold exit 76 (owner `05d9f0f2` / meta-soup-stabilize). Upstream/main conflict already resolved in remat WT; hold not cleared. Meta `hapi-restart-hub` pid 743518 patient-draining (WORKING=2). Pin layer not yet absorbed. |
| Hub restart + DB 20→21→22 + Pin proof | **PENDING** hold clear + rebuild |

**Pinged Meta twice** with tip SHA + deadlock note. Peer must not clear hold / steal remat-owner token.

## Remaining after hold clear

1. `hapi-driver-status --quiet` → `hapi-driver-rebuild --build-web --verify` → `hapi-verify-web-dist`
2. Hub/cli changed → `hapi-restart-hub` (patient). Confirm `PRAGMA user_version` = 22 and Pin in session context menu on `:3006`.
3. PNG / `display_image` proof: right-click → Pin; pinned session stays put.
4. **Do not** open an upstream PR that races #1115. Optional comment on #1115: soup remapped pin to **v22** because soup v20=#1359 and upstream #1390 took v21.

## Intake ownership

| Step | Status |
|------|--------|
| Archaeology / conflict discovery | DONE (orchestrator) |
| Union tip + schema remap (→v22) | **DONE** |
| Manifest | **DONE** |
| Rebuild + dogfood proof | **BLOCKED** on remat-hold / Meta |
| Competing upstream PR | **NO** |

Hard rules: no agent stack-switch; no hand-edit inside `driver/` except via rebuild; commit tooling dirt same turn; never merge `tiann/hapi`.
