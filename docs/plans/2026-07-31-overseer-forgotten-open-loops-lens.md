# Plan: Overseer "what am I forgetting?" — cold open-loops lens

> **Status:** VALIDATED LIVE 2026-07-31 (27B brain on `:3006`). Design agreed; implementation is a
> follow-up owned with 🔁overseer prep (converse/entity layer). NOT built yet.
> **Origin:** operator question — "268/299 sessions, 63 projects; tell me what I'm forgetting." Follow-on
> to [`2026-07-30-overseer-inbox-pr-notif-title-and-scoring.md`](./2026-07-30-overseer-inbox-pr-notif-title-and-scoring.md).

## The reframe (operator, 2026-07-31)

"Forgotten" is NOT a priority. Urgency and neglect are orthogonal axes. The key unlock: **every agent turn
already self-dispositions** via `AGENT_NOTIFY_SUMMARY` (`status` ∈ done/blocked/needs_review/needs_decision/
failed/stalled, plus a concrete `action`). So a "missed thing" is self-populating with zero operator triage:

> **A cold open loop = a thread whose latest agent status is NOT `done` and carried a real next-action, that
> then went cold (no newer turn closed it).**

## Why not just the inbox / priority

Live probe of the 174 active inbox items (`:3006`, 2026-07-30/31):
- **0 have any operator disposition** (0 snoozed, 0 feedback; 7 resolved / 1 dismissed in all history). The
  operator has never used the inbox UI. So "old + no operator action" = *everything*; useless as a filter.
- The self-disposition signal is the substitute. Splitting worker (133) vs channel/PR (41), then keying on
  status≠done + real action:

  | Tier | Definition | Count | >30d |
  |---|---|---|---|
  | A | latest status UNFINISHED + real next-action | 22 (~19 real) | 6 |
  | B | latest = DONE but `action` field still filled | 108 | 25 |

- **Correction to the operator's first cut:** the strong filter is `status != done`, NOT "action present."
  On a done turn the agent stuffs `action` with a no-op ("none/optional/complete") → Tier B is 108 false
  positives. Action text is a tiebreak, drop the no-ops.

## Live validation (both passed)

**2a — brain unaided** ("what am I FORGETTING, cold loops, ignore done, rank by coldness"): brain queried
`query_events` for `needs_decision` and returned 10 cold loops **not even present as active inbox items**
(WebDAV cleanup, dad-music dump, lockhouse rescue, mail-retrieve, privoxy…), each as *loop + what it awaits
from the operator*. → the raw events substrate is a richer source than the coalesced inbox.

**2b — curation over the pre-filtered candidate set**: brain correctly (1) split **"Waiting on You"**
(jellyfin 22d, RAG 7d, expenses 6d, content-slice choice 6d, …) from **"Half-Finished Work"** (Win10 VM 34d,
web extension 18d, …); (2) ranked each by coldness; (3) **dropped** every legacy/no-op/abandoned row
(`(none)` actions, "No agent output" hub noise, "standing down per user"). Hit-rate ≫ 50% kill-criterion.

## Design (agreed)

- **Separate lens, not a priority number.** Same store, different query. Two Overseer questions:
  "what needs me now?" (urgency, priority-sorted — the 2026-07-30 fix) vs "what have I abandoned?"
  (neglect, age-sorted among the not-`done`).
- **Source:** raw `events` (`needs_decision`/`blocked`/`failed`/`needs_review` with an `action`, no later
  `completed`) is richer than the coalesced inbox; use events, fall back to inbox item `category`/`suggestedAction`/`updatedAt`.
- **Filter:** worker-sourced · latest status ≠ done · action not a no-op · aged (cold) · not archived.
- **Present:** brain-curated top-N; **"Waiting on You" (operator owes a decision) first**, then half-finished.
- **Cadence:** a pull ("what am I forgetting?") and/or a weekly digest. **Never an interrupt/ping.**
- **Doubles as triage bootstrap:** surface ~15-20 cold loops, operator taps done/skip/nudge — the disposition
  loop the spec always wanted, now tractable because the agents populated it.

## Cheapest → fuller build path

1. **Zero-code (works today):** a saved converse prompt (test 2a). Document it; optionally schedule a weekly
   digest that runs it and posts once. Immediate value, no substrate change.
2. **Small tool (nice):** a read-only `query_open_loops` in the overseer entity (age + status≠done + real-action
   + no-later-completed) so the brain doesn't re-derive ages each time. Consistent, cacheable, cheaper tokens.
3. **Archiving hygiene (parallel, high-leverage):** 268/299 sessions, most done. Aggressive archive so the
   live set is small; a forgotten-digest over ~30 live threads is gold, over 299 is noise. Legacy STALE rows
   ("No agent output for 30 minutes") should be swept.

## Kill-criteria
- If the curated cold set is <50% "real miss" (mostly killed-on-purpose) → it's a graveyard; archiving wins,
  don't build the lens. **(Not triggered — live hit-rate high.)**
- If a weekly digest gets ignored within ~2 weeks → cadence/curation wrong; it became a second swamp.

## Ownership / boundaries
- Lens lives in the **converse/entity layer** (`feat/overseer-*`, owned with 🔁overseer prep) — NOT the
  ingest/scoring layer this peer owns. Hand off for implementation; this doc is the validated design + evidence.
- Unrelated but observed: the converse brain earlier mis-stated priority direction (called p50 "highest").
  Priority is lower-is-higher; worth a system-prompt note in the converse layer.
