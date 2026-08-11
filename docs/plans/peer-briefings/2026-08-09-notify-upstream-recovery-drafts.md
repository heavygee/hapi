# Drafts for operator approval — notify summary upstream recovery

> **DO NOT POST** until operator says go.  
> Plan: [`../2026-08-09-notify-summary-upstream-recovery.md`](../2026-08-09-notify-summary-upstream-recovery.md)

---

## Draft A — comment on [tiann/hapi#1462](https://github.com/tiann/hapi/pull/1462)

```markdown
Thanks for this — the compact metadata row is genuinely good UX.

Also: sorry we shipped #1376 (opt-in emit) without the corresponding default chat removal on the same train. That left vanilla users staring at a raw machine footer when the toggle is on — your PR is exactly the kind of "wait, this is ugly" reaction that gap deserved 😂

Product context, tying into the A2A control-plane thread ([#1332](https://github.com/tiann/hapi/discussions/1332)):

`AGENT_NOTIFY_SUMMARY` started as FCM enrichment (#803). #1376 added an optional Settings toggle so agents can **emit** that footer. The A2A RFC treats the line as a **machine status contract** (Layer 0→1): best-effort worker self-report that should land in the work-graph ledger (P1 [#1374](https://github.com/tiann/hapi/issues/1374), then P3 notify→ledger ingest — separate PR), not as always-on chat chrome.

So the continuum looks like:

1. **Emit** — #1376 (shipped, opt-in today)
2. **Capture** — P3 ingest into `events` / work-graph ([#1465](https://github.com/tiann/hapi/issues/1465) / [#1467](https://github.com/tiann/hapi/pull/1467); includes A0 substrate aligned with #1374 contracts)
3. **Display** — by default **hide** from chat (render-time strip; store keeps the raw line for FCM/parse/ledger); optional **show** = exactly your compact row

Only once (2) and (3) both exist can we responsibly flip emit to **always on, optionally disable**. Until then, people who hate the raw line have no clean escape except turning emit off — and disabling emit also turns off the status feed that upcoming A2A abilities (#1332 P2+ / work-ads / stale detection) will consume. Display control lets chat stay clean (or nice) without starving the ledger.

Your presentation work is the right shape for the **show** path. If it lands alone as always-on, every enabled-emit user gets a chat affordance with no opt-out, while the durable ledger path was incomplete until #1467.

### Ask

Could you extend this PR (or a small follow-up on the same branch) with a Settings sibling to #1376, roughly:

- **Show session status summary in chat** (name bikeshed-ok)
- **Default: off** (hide / strip from chat + copy)
- **When on:** render your compact `NotifySummaryText` row (not raw JSON)
- **Invariant:** display never gates parse/FCM; display must not gate capture (#1467)

Happy to take strip/default-off ourselves via #1464 if you would rather keep this PR presentation-only — either way we want your compact row as the **on** renderer, not a competing always-on design.

Refs: #1332, #1374, #1376, #1464, #1465, #1467.
```

---

## Draft B — new issue: A2A P3 notify ingest (Workstream A)

**Title:** `feat(a2a): P3 AGENT_NOTIFY_SUMMARY → work-graph status ingest`

```markdown
## Continuum

Part of the A2A control-plane sequence in [#1332](https://github.com/tiann/hapi/discussions/1332):

| Piece | Status |
|-------|--------|
| Notify parse for FCM | #803 shipped |
| Opt-in emit | #1376 shipped |
| P1 `events` / `event_links` + principal/namespace | #1374 |
| **P3 notify → ledger status ingest** | **this issue** |
| Chat display (default hide / compact show) | #1462 + #1464 |

RFC: elevate `AGENT_NOTIFY_SUMMARY` from "nicer push body" to best-effort worker status emission for the work-graph ledger (`status` / `summary` / `action` → work-ad feed fields). Emission stays **opt-in** (#1376 as shipped) until the gate below.

## Problem

With #1376 enabled, agents can emit the footer, but vanilla hub still has nowhere durable to put the structured value until P1+P3 land. Chat pretty-printing (#1462) is UX, not capture.

## Proposal (thin)

1. Sit on #1374 substrate (or land A0 only if P1 blocked — **one** events schema, no rival table)
2. On assistant message ingest: `extractNotifySummary` → idempotent ledger insert (type/provenance per #1374 + RFC mapping)
3. Minimal verify path (query by `related_session_id` / existing P1 debug surface)

## Non-goals (v1)

- P2 handoff/receipt flows
- Privileged-reader / fleet UI (RFC "Later")
- Flipping #1376 emit default in this PR
- Chat display (#1462 / #1464)

## Kill criteria

- [ ] Emit on → well-formed footer → ledger row; display-off does not block capture
- [ ] Idempotent on same message
- [ ] Namespace/principal isolation per #1374
- [ ] Field mapping matches RFC notify-elevation table

## Sequencing / default-emit gate

Prefer P1 (#1374) → this P3 → default-hide display (#1464 / #1462 setting) on the same release train. Do not ship default-hide without capture.

**Later (separate change):** flip emit to always-on / optionally-disable **only after** both capture (this issue) and display control (#1462/#1464) are on main. Disabling emit is not cosmetic — it turns off the worker status feed that upcoming A2A abilities consume. Users should keep chat clean via display settings, not by starving the ledger.

## Related

#1332, #1374, #1376, #803, #1464.
```

---

## Draft C — replace body of [#1464](https://github.com/tiann/hapi/issues/1464)

**New title:** `feat(web): settings for AGENT_NOTIFY_SUMMARY chat display (default hide)`

```markdown
## Continuum

A2A [#1332](https://github.com/tiann/hapi/discussions/1332): `#1376` emit + upcoming P3 ledger ingest treat `AGENT_NOTIFY_SUMMARY` as a **machine status contract**. Chat should not force raw JSON or always-on pretty metadata. Display is an optional human lens on top of emit+capture.

## Problem

#1376 injects the emit contract. Without a display control, vanilla chat either shows raw JSON or always-on pretty metadata (#1462). Product intent: **default hide**; optional show via compact UI.

## Proposal

Settings sibling to #1376:

- **Show session status summary in chat** — default **off**
- Off → render-time strip (shared strip helper / copy path); store unchanged
- On → #1462 compact `NotifySummaryText` (prefer folding their PR or depending on it)

Coordinate with @techotaku39 on #1462. If they add the setting there, this issue tracks acceptance; else we land strip + setting and adopt their component as show renderer.

## Depends on

A2A P3 notify→ledger ingest (separate issue; sits on #1374). **Do not** merge default-hide without capture on the same release train.

## Default-emit gate (not this issue)

Only after **capture (P3) + this display control** both ship can #1376 flip from opt-in emit to **always emit, optionally disable**. Until then, the only escape from a raw footer is turning emit off — which also disables the status feed upcoming A2A abilities will use. Display control is what makes default-on emit safe for humans without making opt-out the path of least resistance.

## Kill criterion

Emit on + display off → chat clean; store still has raw footer; once P3 lands, ledger row exists. Display on → compact row, not raw JSON.

## Out of scope

Cursor rule overlay, hub synthetic fallback, FCM changes, P2 handoffs, flipping emit default.
```