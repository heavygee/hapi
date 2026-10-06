# Peer briefing: soup-promote upstream #1115 (persistent pinned sessions)

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/web-pinned-sessions-soup`  
**Branch:** `driver/web-pinned-sessions` (layer **DROPPED** after merge)  
**Upstream PR:** https://github.com/tiann/hapi/pull/1115 — **MERGED** `3da9f7780` (2026-08-08, heavygee squash)  
**Issue:** https://github.com/tiann/hapi/issues/532 — **CLOSED**

## Final status (2026-08-08) — DONE

| Step | Status |
|------|--------|
| Soup dogfood (single-mode then global band) | DONE |
| Author dual-mode + v22 rebase | DONE |
| Thread hygiene / CLEAN | DONE |
| Upstream merge | **DONE** — squash `3da9f7780` |
| Drop manifest layer | **DONE** |
| Remat / `global_pinned` on live DB | **DONE** — live tip `0c6b0f874`; hold idle; hub restarted; verify green |

## Notes

- Upstream pin = SCHEMA **v22** with `pinned` + `global_pinned`.
- Soup keeps SCHEMA **23** (session-jobs #1404) + `ensureSessionPinColumns` heal for DBs that already passed v22 with `pinned` only.
- Public GitHub voice: no estate jargon on others' PRs; operator-first.

Hard rules: no agent stack-switch; no hand-edit inside `driver/` except via rebuild.
