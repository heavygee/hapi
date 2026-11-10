# Session row state rendering — three-way comparison

**Date:** 2026-11-09 (inventory verified 2026-11-10)
**Role:** Rationale for upstream work on **session attention for multi-session fleets**.
PRs in that set should link here (or to the umbrella issue that cites this).

**Why:** What states a session can be in, and what three trees draw for them — upstream
`main`, IanMStevenson's #2296 tip, and the local fork that has been running the attention
work at fleet scale (1,000+ sessions, ≥~30 resident at a time).

**Sources read directly:**
- Upstream `main`: `web/src/components/SessionRowSummary.tsx` (post `832c5922f`, 2026-11-01)
- Ian #2296: `IanMStevenson/hapi@f67e13905308` same file
- Local fork tip used for the live comparison: `ff7e86490` same file

---

## Axes a session varies on

1. **Runner residency** — `s.active`. A runner has the session loaded in memory. Not the same as "doing work".
2. **Agent activity** — `s.thinking` (foreground), `backgroundTaskCount > 0`.
3. **Needs a human** — `pendingRequestsCount`, `attention.kind` (permission / input / background / unread).
4. **Lifecycle** — `metadata.lifecycleState === 'archived'`.
5. **Work / attention chrome** — attached-job progress; blocked-with-reason from the last status summary.

## Session list status mode

`sessionListStatusMode: 'standard' | 'detailed'`, default `standard` — Settings → Display →
"Session list status" (`web/src/hooks/useSessionListStatusMode.ts` on `main`). Feeds
`showDetailedStatus`, which gates some marker-slot chrome on the local fork:

- schedule tooltip — gated
- background attention indicator — gated
- background spinner — half gated:
  `(showDetailedStatus && attention==='background') || (s.active && bgCount>0)`

Upstream's presence dot and Ian's badge are not mode-gated; both render in `standard`.

## What each codebase draws

| State | Condition | Upstream `main` | Ian #2296 | Local fork (prior) |
|---|---|---|---|---|
| Working | `active && thinking` | green dot on icon, pulsing | green dot, pulsing (`working`) | inline spinner, marker slot |
| Background work | `active && !thinking && bgCount>0` | blue dot, pulsing | blue dot, pulsing (`background`) | blue spinner |
| Idle / waiting | `active && !thinking && !bgCount` | green dot, solid | hollow ring (`waiting`) | nothing rendered |
| Not resident | `!active` | no dot, row normal | power mark (`stopped`) | row `opacity-50` + muted title |
| Archived | `lifecycleState==='archived'` | not modelled → reads as `!active` | folded into `stopped` (per his comment) | not modelled → reads as `!active` |
| Needs permission/input | pending / urgent attention | request icon | unchanged from upstream | amber pulsing dot + "pending" label |
| Blocked, with reason | last status summary → blocked | — | — | blocked chip + Blocked section |
| Running attached job | `attachedJob.status==='running'` | job meter (via #1424, merged 2026-11-10) | — | job label + progress meter |
| Unread | `sessionIsUnread` | semibold title | semibold title (source → `attention.kind`) | semibold title + accent time |

---

## Findings

1. **Different surfaces.** Upstream and Ian put presence on the agent icon as a corner dot. The
   local fork put activity in a marker slot beside the title and used row opacity for
   non-residency. Same concepts, three places in the DOM.

2. **Ian's new marks vs current `main` are two**, not four:
   - `waiting` → hollow ring, where `main` draws a solid green dot.
   - `stopped` → power mark, where `main` draws nothing.
   His `working` and `background` match `main`'s existing dot states.

3. **Nobody separates archived from non-resident.** Ian's comment: *"power mark = stopped or
   archived"*. Upstream does not model `lifecycleState` in this file; dimming on the local fork
   follows `!s.active`.

4. **Blocked-with-reason** is on the local fork and is the body of the PRs proposed here. It is
   not on `main` today.

5. **Row fade marks non-residency.** A faded row means no runner has the session in memory.
   Job chrome is a separate signal. Wake-on-complete (landed with #1424) brings the session
   back when outliving work finishes, so the session need not stay resident for the wait.

## After `832c5922f`

`832c5922f` (2026-11-01) removed the row-level fade and moved activity to the icon dot. That
activity signal stays. What this set adds on the same surface:

- restore **non-residency** as a row-level fade
- land **blocked-with-reason** chrome
- use status summaries as the producer for "what does it need from me"

Attached-job list chrome is already on `main` (#1424, merged 2026-11-10).

## Waiting is not unread

- `waiting` = `s.active && !thinking && !bgCount` — resident, nothing running.
- `unread` = `sessionIsUnread(...)` — activity the operator has not seen.

A session can be waiting and already read, or waiting and unread. When an agent finishes a turn,
both are often true at once. Unread already has its own affordance in all three trees (semibold
title; local fork also accents the time). Ian's `waiting` ring therefore marks a state unread
already covers for the interesting case, and also fires when the session is idle and already
read.

## Direction

1. Keep the fade; do not adopt the power mark. Non-residency is a whole-list scan property.
2. Fade means the session is not resident.
3. Do not adopt the `waiting` ring; unread already covers the useful half of that overlap.
4. Keep `main`'s working/background dot colours as the activity axis beside the fade.
5. `832c5922f` removed a row-level non-residency signal that existed before (`bc543dc49`). Restore
   a row-level fade; do not import a badge taxonomy.
6. Prefer always-on activity signalling over chrome that only appears in
   `sessionListStatusMode: detailed`.

## What this is for

When an agent finishes, the list should show what it concluded and what it needs next. Status
summaries feed that; blocked chrome surfaces it.

---

# Part 2 — already on `main`, open PRs/issues, and what comes next

A large body of this work was dogfooded on a live multi-session install, then pushed upstream
piece by piece. Status summaries (`AGENT_NOTIFY_SUMMARY`, "Emit status summaries" setting,
parse / FCM / work-graph ingest) already ship on `main`. Attached jobs are on `main` as of
#1424. What follows is the rest of the attention surface: open work to finish, then the next
PRs under the same umbrella.

## Already on `main`

| Piece | Ref |
|---|---|
| Status-summary contract + emit setting | CLI / hub settings on `main` |
| Parse, FCM, native companion, work-graph ingest of that line | hub + protocol on `main` |
| Activity dots (green working / blue background) | `832c5922f` |
| Cursor post-`done` harness silence | #2267 family |
| Unread list filters / keep-unread-visible | #2292, #2294 (IanMStevenson) |
| Session list sort/filter primitives | #2263 |
| Session-attached jobs + wake-on-complete | **#1424** (merged 2026-11-10; closes #1404 / #1489) |

## Open on upstream (finish these)

| Topic | Ref | Status |
|---|---|---|
| Blocked affordance: section, rail, jump pill, mark-unblocked | Issue **#1717** | Open issue; **no PR yet** |
| Cursor unexpected-stop → retry then blocked footer | PR **#1725** (issue #1724) | Open PR |
| Session-list scrollbar tick for open session | Issue #1732, PR **#1733** | Open PR |
| Combined session-list filter menu | PR **#1772** | Open PR (`dogfooded`) |
| Fold blocked lens into that filter menu | Issue **#1996** | Open issue; depends on #1772 |
| Active + Working lenses in the filter menu | Issue **#2002** | Open issue; **no PR yet**. Already present on the local fork's filter menu (dogfood); still needs an upstream PR |
| Discovery callouts for shipped-but-unlabelled controls | PR **#2339** | Open PR |
| Inline model errors (`resource_exhausted` etc.) → surface + notify | Issue #878, PR **#987** | Open PR |

## Next PRs under this umbrella

Dogfooded on the local fork; open as upstream PRs linked to the umbrella issue:

| Topic | Intent |
|---|---|
| Restore row-level fade for non-residency (beside the activity dot) | After `832c5922f` |
| Hub-authored blocker sources for terminal agent errors | Extends #1717 |
| Persist last status summary onto session-list fields | Bridge emit → blocked chrome |
| Settings: flag blocked sessions from status summaries (default on) | Below the existing emit toggle |
| First-use introduction for the blocked affordance | Upstream FUE primitives |
| Blocked affordance PR for #1717 | Chrome itself |
| Active + Working lenses PR for #2002 | Mirror what the local fork already ships in the filter menu |

## Seams

1. Blocked chrome needs the last status summary on the session row — emit already exists on
   `main`; list persistence and default-on are still open.
2. Fade, job meter, and activity dot all speak to liveness; land in the umbrella order so they
   compose on purpose.
3. #1996 and #2002 extend #1772's menu.
4. Prefer always-on chrome over `sessionListStatusMode: detailed`.
5. #1725 / #987 exist so "blocked" and model-error states fire correctly — producer work, not
   badge polish.

## Order

1. Attached jobs — **done** (#1424).
2. #1717 blocked chrome (+ #1725).
3. Hub-authored blockers once blocked chrome merges.
4. Row-level fade for non-residency.
5. #1772 → #1996 → #2002.
6. Settings / FUE / #2339 as listed above.
