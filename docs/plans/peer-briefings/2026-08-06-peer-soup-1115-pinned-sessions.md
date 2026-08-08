# Peer briefing: soup-promote upstream #1115 (persistent pinned sessions)

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/web-pinned-sessions-soup`  
**Branch:** `driver/web-pinned-sessions` (soup union tip; layer **DROPPED** after merge)  
**Upstream PR:** https://github.com/tiann/hapi/pull/1115 — **MERGED** `3da9f7780` (2026-08-08, heavygee squash)  
**Issue:** https://github.com/tiann/hapi/issues/532 — should close with merge  

## Final status (2026-08-08)

| Step | Status |
|------|--------|
| Soup dogfood (single-mode then global band) | DONE |
| Author dual-mode + v22 rebase | DONE (`c9712bbc`) |
| Thread hygiene / CLEAN | DONE |
| Upstream merge | **DONE** — squash `3da9f7780` |
| Drop manifest layer | **DONE** |
| Remat / `global_pinned` on live DB | in progress this turn |

## Notes

- Upstream pin = SCHEMA **v22** with `pinned` + `global_pinned`.
- Soup had earlier single-column pin at v22; live DB was **user_version=23** with `pinned` only (session-jobs owns v23). Remat must ensure `global_pinned` exists even when version is already 23.
- Public GitHub voice: no estate jargon on others' PRs; operator-first.

Hard rules: no agent stack-switch; no hand-edit inside `driver/` except via rebuild.
