# Recovery plan: AGENT_NOTIFY_SUMMARY emit without capture/display (2026-08-09)

> **Status:** operator-directed recovery; next slice of the **A2A control-plane** continuum ([discussion #1332](https://github.com/tiann/hapi/discussions/1332), estate RFC `docs/plans/2026-08-03-a2a-control-plane-rfc.md`).  
> **Owners:** orchestrator session `a492a270` with A2A P1 peer (`e1ee1785` / #1374); dedicated peers for display + notify ingest; upstream watcher briefs / #1462 human reply.  
> **Do not** treat community [#1462](https://github.com/tiann/hapi/pull/1462) as the full fix.  
> **Public voice:** continuum of A2A work already on the table - not "fork rescue," not "I lead this." No other product names in public GitHub text.

---

## Continuum (how this sits in A2A)

Public RFC phases ([#1332](https://github.com/tiann/hapi/discussions/1332)):

| Phase | Deliverable | Upstream status |
|-------|-------------|-----------------|
| Layer 0 | cite / inspect / ping | shipped (#1195, #1228, …) |
| — | `AGENT_NOTIFY_SUMMARY` parse for FCM | shipped (#803) |
| — | Opt-in **emit** of that footer | shipped (#1376) |
| **P1** | `events` / `event_links` + principal/namespace | [#1374](https://github.com/tiann/hapi/issues/1374) open |
| P2 | handoff create / deliver / receipt | later |
| **P3** | `AGENT_NOTIFY_SUMMARY` → work-ad / **status ingest** into ledger | **this recovery Workstream A** |
| P4 | query APIs + minimal debug surfaces | later |
| UX | chat display of the footer (hide default / compact show) | #1462 + #1464 (Workstream B) |

RFC § `AGENT_NOTIFY_SUMMARY` elevation already says: promote the line from "nicer push body" to **best-effort worker status emission for the A2A ledger**. #1376 without P1+P3 is emit with nowhere durable to land. #1462 without a display setting is always-on presentation of a machine contract.

**Boundary (keep clean):** Layer 0 session-jobs meters ≠ Layer 1 `work_ad` / notify status rows. Notify ingest feeds the **ledger**, not the job progress meter. Coordinate substrate with #1374 - **do not** invent a second rival `events` table.

---

## Fuckup (one paragraph)

We shipped **Settings → Ask agents to emit session status summary** ([#1376](https://github.com/tiann/hapi/pull/1376)) on `tiann/hapi` - the emit half of A2A P3 - ahead of P1 ledger (#1374) and P3 ingest. Dogfood already strips the footer from default chat and deposits parsed summaries into hub `events`. Upstream has neither substrate nor strip. Vanilla users who enable the toggle get raw JSON in chat; the structured value does not become a ledger event. [#1462](https://github.com/tiann/hapi/pull/1462) correctly notices the ugly chat and offers a nice compact row - necessary UX, not the A2A capture path.

---

## Target product (three knobs, one invariant)

| # | Control | Default **now** | Default **after gates** | Upstream status |
|---|---------|-----------------|-------------------------|-----------------|
| 1 | **Emit** — agents append footer (#1376) | off (opt-in) | **on** (opt-out) | **Shipped** as opt-in |
| 2 | **Display** — show compact metadata in chat (#1462 UI + setting) | **off** (hide) | off (hide) | Missing |
| 3 | **Capture** — parse footer → hub `events` row | always when well-formed | always when well-formed | **Missing** on upstream |

**Invariant:** display mode never gates capture. Hide = chat clean; store + events still get the parse. Show = #1462-style compact row (not raw JSON).

### Default-emit flip (later — hard gate)

**Do not** flip #1376 to "always emit, optionally disable" until **both** are on `tiann/hapi` main:

1. **Capture** — Workstream A / A2A P3 (footer → ledger)
2. **Display control** — Workstream B (#1462 setting and/or #1464): hide by default, or show compact

Rationale: once emit is on by default, turning it **off** is not a cosmetic preference — it starves the work-graph of worker status self-reports and weakens upcoming A2A abilities that consume that feed (P2 handoffs / work-ads / stale detection per #1332). Users must be able to keep chat clean (or nice) **without** having to disable emit to escape raw JSON.

Until those gates land, emit stays opt-in (#1376 as shipped).

Settings UX (General, under Agents / next to emit toggle):

1. *Ask agents to emit session status summary* (existing; flip to opt-out only after gates)  
2. *Show session status summary in chat* (new) — when on, render #1462 compact row; when off (default), strip from chat+copy  

Debug raw JSON remains optional (estate About toggle) — not required upstream v1.

---

## Workstream A — PR: A2A P3 notify → ledger (thin)

**Goal:** On vanilla hub, every well-formed trailing `AGENT_NOTIFY_SUMMARY` becomes a durable ledger row - RFC P3 / #1332 "elevate to work-ad feed" - not merely FCM enrichment.

**Depends on / coordinates with:** [#1374](https://github.com/tiann/hapi/issues/1374) (A2A P1 work-graph). Prefer **one** `events` substrate. If #1374 lands first, A is ingest-only on that schema. If A must move first, shape A0 to match the RFC + #1374 field contracts so P1 does not rewrite.

**Implementation prior art (estate-internal only; never cite by product name upstream):**

- Substrate: A2A P1 worktree `a2a-p1-ledger` / dogfood hub `events` store  
- Ingest: notify-summary recorder on assistant message path - `extractNotifySummary` → insert event, wired from `syncEngine`

**Upstream PR shape:**

1. **A0 — P1 substrate** — only if #1374 not yet mergeable; otherwise skip and sit on #1374  
2. **A1 — P3 notify recorder** — map notify fields → ledger status/summary/action per RFC table; no LLM fallback, no Cursor overlay, no privileged-reader UI  

Kill-criteria for A1:

- [ ] Enable #1376 → well-formed footer → **ledger row** (provenance / type per #1374 schema)  
- [ ] Idempotent: same message does not duplicate  
- [ ] Namespace/principal isolation per #1374  
- [ ] Chat still shows raw footer until Workstream B (ok interim) **or** same train as B  

**Issue title:** `feat(a2a): P3 AGENT_NOTIFY_SUMMARY → work-graph status ingest`  
Link: #1332, #1374, #1376, #803, #1464. Do not overload #1464 (display).

**Peer:** coordinate with `e1ee1785` (#1374); spawn ingest peer off `upstream/main` (or stacked on P1 branch). Public framing = A2A P3 only.

---

## Workstream B — #1462 + settings (display)

**Ask @techotaku39** (draft in peer-briefings — post only after operator OK):

- Keep their compact `NotifySummaryText` UI — it is the **show** mode.  
- Add hub-or-client setting sibling to #1376: **Show session status summary in chat**, **default off**.  
- When off: strip footer from chat render + copy (shared strip helper / copy path).  
- When on: render their compact row (not raw JSON).  
- Explicit non-goals for their PR: events ingest (Workstream A). Document that hide-by-default assumes A lands (or land same release).

**Our side if they decline:** Peer #1464 / follow-up owns strip + setting; optionally cherry-pick their component as the show renderer.

Update [#1464](https://github.com/tiann/hapi/issues/1464) body to match "display setting + compact show mode", not strip-only.

---

## Sequencing

```text
Week 0 (now)
  - File P3 #1465; retitle #1464; spawn Peer #1465 (impl)
  - Sync with A2A P1 peer e1ee1785 / #1374 — one substrate
  - Peer #1465 tip ready → **full court press** (pr-review-loop.md):
      (1) Cursor claude-opus-5-thinking-high → fix Majors
      (2) Cursor gpt-5.6-sol-high → fix Majors
      Brief: docs/plans/peer-briefings/2026-08-09-peer-a2a-p3-cold-reviews.md
  - Full court press COMPLETE (Claude→FIX→Sol→FIX) on private tip — **then** open/undraft upstream PR
    (opening early = HAPI Bot attacks uncooked tip; incident #1467 2026-08-09)
  - Then post #1462 techotaku note linking that PR

Prefer merge order: #1374 (P1) → A1 (P3) → B (display)
  (capture before hide-by-default so we never hide into the void)

Acceptable: B merge with default-off show, with A1 already on main
Forbidden: default-hide on upstream without A1 on the same train
Forbidden: second rival events table beside #1374
Forbidden: flip emit default to on before A1 + B both ship
Forbidden: #1462 note before #1465 PR URL + both cold passes closed
Later (gated): emit default on / opt-out — only after capture + display control
```

---

## Explicitly out of scope (this recovery)

- Cursor rule-overlay emit (estate-only)  
- Privileged-reader / fleet UI (RFC "Later")  
- P2 handoff/receipt (separate A2A phase)  
- Flipping #1376 emit default **in this recovery** (stays opt-in until gates)  
- Voice `audience` field (estate-side; separate)  
- Public "I lead this" framing — continuum speaks for itself via #1332 refs  

---

## Success

**Near-term (gates):** emit opt-in **on**, display **off** → chat clean; ledger row; FCM works.  
Emit on, display on → #1462 compact metadata.  
Emit off → no footer, no new notify ledger rows (and A2A status feed goes dark for that session).

**Later (after A1 + B):** emit default **on** / optionally disable — disable documented as impacting A2A status ingest.

---

## Operator checkpoints

1. Approve #1462 comment draft → watcher posts  
2. Approve spawn Peer A (P3 ingest) + retask Peer B (#1464 display)  
3. No merge on `tiann/hapi` without green CI + your lane policy  
