# Overseer "what am I forgetting?" — cold open-loops lens (implementation)

> **Branch:** `feat/overseer-open-loops` (stacked on `feat/overseer-text-converse`).
> **Design + evidence:** [`2026-07-31-overseer-forgotten-open-loops-lens.md`](./2026-07-31-overseer-forgotten-open-loops-lens.md)
> (validated live against the 27B on `:3006`). This doc = what landed.

The lens is the **neglect axis** — "what have I abandoned?" — orthogonal to the urgency axis
("what needs me now?", `query_inbox` + `explain_priority`). It is self-populating from the
`AGENT_NOTIFY_SUMMARY` each worker turn already emits; **no operator triage required**.

## What landed (build path steps 1 + 2)

### Step 2 — `query_open_loops` read-only tool

An 8th read-only Overseer tool. Definition:

> **A cold open loop** = a session whose *latest* status-bearing worker event is NOT `done`
> (`needs_decision` / `needs_review` / `blocked` / `failed` / `stalled`) and was never closed by
> a later `completed`.

- **Substrate:** raw `events`, not the coalesced inbox (the design showed events surface ~10 real
  forgotten decisions that never became inbox items). One indexed query takes the latest
  status-bearing worker event **per session** (`progress` is excluded — a progress ping does not
  close an operator-owed decision; `completed` is the only closer).
- **Strong filter:** `status != done`. A no-op `action` ("none"/"complete"/"n/a"/…) is nulled but
  the loop still surfaces — action text is a *tiebreak*, not the filter (per the spec correction
  that killed 108 Tier-B false positives).
- **Buckets:** `waiting_on_you` (needs_decision / needs_review — the operator owes a decision) is
  presented **before** `half_finished` (blocked / failed / stalled). Each bucket is **coldest-first**.
- **Args:** `{ minAgeMs?, bucket?, project?, limit? }` — `minAgeMs` is the "went cold" knob (default 0,
  raise it to focus on genuinely stale threads).
- **Returns:** `{ openLoops: [{ sessionId, name, project, flavor, status, eventType, eventId, action,
  summary, lastTs, ageMs, ageDays, bucket }], counts: { total, waitingOnYou, halfFinished } }`.
  The brain-facing projection thins this to `{ id, name, project, status, action, what, ageDays, bucket }`.

### System-prompt changes (converse/entity layer)

- **Two questions, two axes** section: urgency (`query_inbox`, priority-ordered) vs neglect
  (`query_open_loops`, age-ordered). Tells the brain which tool answers "what am I forgetting?".
- **Priority direction fix:** priority is **lower-is-higher** (1 = most important). This corrects the
  27B's live mistake of calling p50 "highest".

## Step 1 — zero-code weekly digest (works today, no substrate change)

`query_open_loops` makes the "what am I forgetting?" converse prompt reliable. A scheduled weekly
digest can send this to `POST /api/overseer/converse` and post the reply once (never an interrupt):

```
What have I forgotten or abandoned? Use query_open_loops (minAgeMs = 3 days). Lead with the
"Waiting on You" bucket — decisions I owe — then half-finished work. For each, one line: what it is,
how many days cold, and the concrete next step (skip ones with no real next step). Do not rank by
priority; this is about neglect, not urgency. Keep it to the top ~15.
```

This doubles as a **triage bootstrap**: surface ~15 cold loops, operator dispositions them, and the
inbox disposition loop the spec always wanted becomes tractable.

## Not in this branch (follow-ups)

- **Archiving hygiene (step 3):** aggressive session archive + sweeping legacy `stale`
  ("No agent output for 30 minutes") rows that predate the fix which stopped writing them
  (`checkStaleSessions` already returns `[]`; those legacy rows are `source_kind=system` so
  `query_open_loops` — worker-only — already excludes them from the lens, but they still bloat
  Session Logs). Coordinate the sweep with the inbox-ingest lane.
- **Dependency:** inbox PR-title + priority-band fix (PR #99) lands on the urgency axis, independent
  of this lens.
