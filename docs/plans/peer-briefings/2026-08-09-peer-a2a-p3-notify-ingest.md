# Peer brief: A2A P3 AGENT_NOTIFY_SUMMARY → work-graph status ingest

> Orchestrator: upstream watcher / Meta lane (Cursor `0ac85fdb…`; ping-back HAPI `9f5f7e1d` meta - PR watcher).  
> Canon plan: `docs/plans/2026-08-09-notify-summary-upstream-recovery.md`  
> **Public voice: A2A only. Do not mention overseer / fork product names in issues, PRs, or comments.**

---

## Parent

- Orchestrator HAPI session (ping-back target): `9f5f7e1d-d1d8-4d17-a668-0a0fdf4af685`
- Operator request (verbatim intent): open the upstream PR that captures `AGENT_NOTIFY_SUMMARY` into the A2A work-graph ledger (P3), **before** we comment on community #1462; do this via peer (not the orchestrator).

## Intake status (orchestrator completed)

- [x] 1 Code search — DONE: dogfood notify→events on soup; upstream has #1376 emit + #803 FCM parse; no ledger ingest on vanilla tip
- [x] 2 Upstream search — DONE: #1332 A2A RFC (P3 = notify→ledger); #1374 P1 ledger open; #1376 emit shipped; #1462 pretty UI; #1464 display track
- [x] 3 Playback — DONE: operator approved A2A framing + default-emit gate + apology on #1462 after PR exists
- [x] 4 Issue — https://github.com/tiann/hapi/issues/1465 ; peer attaches PR with `Fixes #1465`
- [x] 5 Proof path — **peer stack** for gates; soup-promote only if operator asks for `:3006` dogfood of this layer (not required to open the upstream PR)

## Your assignment (feature peer)

- Own steps: **implementation + typecheck/test + open/update PR on `tiann/hapi` + fix cold-review Majors**
- **Cold reviews are NOT yours to self-serve.** Orchestrator spawns **two sequential Cursor agent** cold peers after you ping "ready for cold review" with a tip SHA (brief: `docs/plans/peer-briefings/2026-08-09-peer-a2a-p3-cold-reviews.md`):
  1. Pass 1 — model `claude-opus-5-thinking-high`
  2. You fix Blocker/Major
  3. Pass 2 — model `gpt-5.6-sol-high`
  4. You fix Blocker/Major (if any)
- Do **not** ask orchestrator to post #1462 until both cold passes have closed green (or operator deferred).
- Do NOT redo: intake 1–5, #1462 comment, #1464 retitle, spawning cold peers
- Worktree: `~/coding/hapi/worktrees/a2a-p3-notify-ingest` @ branch `feat/a2a-p3-notify-ingest` from **`upstream/main`**
  - Create if missing: `hapi-worktree-create a2a-p3-notify-ingest --branch feat/a2a-p3-notify-ingest` (base upstream/main per tooling)
- Coordinate with Peer #1374 (`e1ee1785` / worktree `a2a-p1-ledger`): **one** `events` substrate. Prefer stacking ingest on #1374 schema when that PR exists; if P1 not mergeable, shape A0 to match RFC + #1374 field contracts (no rival table).
- Read: `docs/plans/2026-08-03-a2a-control-plane-rfc.md` § AGENT_NOTIFY_SUMMARY elevation; `docs/plans/2026-08-09-notify-summary-upstream-recovery.md` Workstream A
- Estate prior art (internal only — do not cite product names upstream): dogfood hub notify recorder on assistant ingest → `extractNotifySummary` → idempotent ledger insert; shared strip helpers are Workstream B, not you

### Scope (thin P3)

1. Sit on #1374 / RFC `events` (+ `event_links` if required by schema)  
2. On assistant message ingest: well-formed trailing `AGENT_NOTIFY_SUMMARY` → idempotent work-graph row (status/summary/action mapping per RFC)  
3. Kill criteria in issue body — meet them with tests  
4. Open PR to `tiann/hapi` with continuum framing (#1332, #1374, #1376, #803)

### Explicitly out of scope

- Chat strip / display settings (#1462 / #1464)  
- Flipping #1376 emit default (gated until capture + display both ship)  
- P2 handoff/receipt  
- Privileged-reader / fleet UI  
- Stack switches / `hapi-use-worktree` / driver hand-edits  
- Commenting on #1462 (orchestrator)

### Close the loop (mandatory when done or blocked)

1. `hapi ping-peer 9f5f7e1d` with: PR URL, issue number, one-paragraph verdict, pointer to this session  
2. Then emit `AGENT_NOTIFY_SUMMARY`  
3. Attach PR chip: `hapi link-pr <url>` on this session  

**Orchestrator next:** once your PR URL lands, post the approved #1462 note (includes apology 😂 + ask for display setting) linking your PR.

## Links

- **Issue (your Fixes target):** https://github.com/tiann/hapi/issues/1465
- Plan: `docs/plans/2026-08-09-notify-summary-upstream-recovery.md`
- Drafts: `docs/plans/peer-briefings/2026-08-09-notify-upstream-recovery-drafts.md`
- This brief: `docs/plans/peer-briefings/2026-08-09-peer-a2a-p3-notify-ingest.md`
- RFC / discussion: https://github.com/tiann/hapi/discussions/1332
- P1: https://github.com/tiann/hapi/issues/1374
- Emit: https://github.com/tiann/hapi/pull/1376
- Display: https://github.com/tiann/hapi/issues/1464 + community https://github.com/tiann/hapi/pull/1462
- Peer #1374 session: `/sessions/e1ee1785-3d49-4f9d-80eb-365e89456ec4`
