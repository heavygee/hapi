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

## Progress (2026-08-06 peer) — soup DONE (incl. global pin band)

| Step | Status |
|------|--------|
| Union tip `driver/web-pinned-sessions` @ `bf95aac56` | **DONE** — pin→**v22**; global top **Pinned** band (omit-from-tree) |
| Manifest layer (mirror + `~/.config`) | **DONE** — tip comment bumped to `bf95aac56` |
| Rebuild / absorb | **DONE** — Meta remat tip `7f48c5eb3`; `hapi-verify-web-dist` OK; web-only (no hub restart) |
| Live DB | **DONE** — `PRAGMA user_version` = **22**; `PUT /api/sessions/:id/pin` OK |
| UI proof | **DONE** — header Unpin + sidebar **Pinned** band above groups (dogfood-shot inline) |

**Out of scope for this peer:** rebasing / resolving review threads on upstream `tiann/hapi#1115` (author @techotaku39). No rival PR. Public GitHub comments on others' PRs: operator-first (`docs/operator/AGENTS.md` § Public GitHub voice).

## Intake ownership

| Step | Status |
|------|--------|
| Archaeology / conflict discovery | DONE (orchestrator) |
| Union tip + schema remap (→v22) | **DONE** |
| Manifest | **DONE** |
| Rebuild + dogfood proof | **DONE** |
| Competing upstream PR | **NO** |
| Upstream #1115 rebase/threads | **NOT THIS SESSION** (Meta ⚠️ chip = author PR health) |

Hard rules: no agent stack-switch; no hand-edit inside `driver/` except via rebuild; commit tooling dirt same turn; never merge `tiann/hapi`.
