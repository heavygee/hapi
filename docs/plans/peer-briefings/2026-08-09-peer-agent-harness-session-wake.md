# Peer briefing: agent-harness wake → HAPI session wake

**Spawned:** 2026-08-09  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/agent-harness-session-wake`  
**Branch:** `feat/agent-harness-session-wake` (from `upstream/main`)  
**Requestor:** Peer #1464 `/sessions/7fd700b2-4d94-4148-862a-afb04d6a193e`  
**Also notify:** Meta `/sessions/9f5f7e1d` (prefix `9f5f7e1d`)

## Discovery (orchestrator)

No upstream/fork issue found that matches **harness wake → hub session wake**. Nearby but **different**:

- [#929](https://github.com/tiann/hapi/issues/929) / [#915](https://github.com/tiann/hapi/issues/915) — runner/hub restart orphan / archive resilience  
- [#826](https://github.com/tiann/hapi/pull/826) — reopen archived sessions  
- Ready / Telegram notifications — end-of-turn ready, not mid-idle harness resume  
- `#1462` / `#1464` continuum — `AGENT_NOTIFY_SUMMARY` **display** (explicitly **out of scope** here)

## Problem

Cursor (and similar) agents arm `notify_on_output` / `/loop` (e.g. long `sleep` + sentinel) so the **agent process** resumes after idle. That wake is harness-local and flaky for long intervals. When it *does* fire, **HAPI often still looks idle** — no session activity / thinking / ready affordance — so operators invent fake waits.

HAPI already has: (1) timed composer message, (2) `hapi job` (progress while agent idle). Missing: when the **underlying agent process** actually wakes (Cursor shell notify, Claude stop/notification hooks, etc.), hub should treat that as a **real session wake**.

This is **harness ↔ hub lifecycle**, not notify-summary chat chrome.

## Your job

1. **File upstream issue** on `tiann/hapi` (problem + non-goals + related issues above).  
2. **Spike / thinnest path** — pick the smallest durable bridge, e.g.:
   - CLI/hub receives a “agent process resumed / turn started” signal from Cursor ACP / hooks and bumps `thinking` / `activeAt` / SSE so the list + push treat it as awake; and/or  
   - Documented hook → `POST` session activity / “wake” endpoint that runners can call from harness notify.  
   Prefer existing socket events over a new product surface if possible.  
3. Implement if spike is clear; otherwise land spike notes + issue acceptance criteria and stop for operator OK before large build.  
4. Ping **7fd700b2** and **9f5f7e1d** with issue URL (and PR if any).  
5. **No upstream PR until operator OK** unless the change is trivially docs-only.

## Intake

| Step | Owner |
|------|--------|
| Discovery | DONE (none found) |
| Upstream issue | **YOU** |
| Spike / thin implement | **YOU** |
| Notify #1464 + Meta | **YOU** |

Hard rules: product edits only in this worktree; never merge `tiann/hapi`; no agent stack-switch.
