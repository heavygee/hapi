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
"Session list status" (`web/src/hooks/useSessionListStatusMode.ts`). This setting is on
`main`. It feeds `showDetailedStatus`, which gates some list chrome (not the activity dot):

- schedule tooltip — gated on `main` and the local fork
- background attention / spinner affordances — gated or half-gated where those markers exist
  (local fork marker slot uses
  `(showDetailedStatus && attention==='background') || (s.active && bgCount>0)`)

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

# Part 2 — landing the rest under this umbrella

I have been dogfooding this attention-management surface on a live multi-session install
(1,000+ sessions, ≥~30 resident at a time). Pieces already on `main` are listed first. Open
PRs are next. Issues that still need a PR are last.

**Intent:** over the next week or two I intend to dogfood and merge the remainder of this set —
open PRs first, then the PRs not yet lodged — under this same umbrella, using the published
`dogfooded` practice (48h UTC opt-out, then merge intent;
[Discussion #2083](https://github.com/tiann/hapi/discussions/2083)). If any item should not
proceed, remove the `dogfooded` label on that PR.

## Already on `main`

| Piece | Ref |
|---|---|
| Status-summary contract + emit setting | CLI / hub settings on `main` (#1375 / #1376) |
| Parse, FCM, native companion, work-graph ingest of that line | hub + protocol on `main` |
| Activity dots (green working / blue background) | `832c5922f` |
| Cursor post-`done` harness silence | #2267 / #2268 |
| Unread list filters / keep-unread-visible | #2292, #2294 (IanMStevenson) |
| Session list sort/filter primitives | #2263 |
| Session-attached jobs + wake-on-complete | **#1424** (merged 2026-11-10; closes #1404 / #1489) |

## PRs already placed (dogfood → merge under this umbrella)

| Topic | Ref | Notes |
|---|---|---|
| Cursor unexpected-stop → retry then blocked footer | PR **#1725** (issue #1724) | Producer plumbing for blocked |
| Session-list scrollbar tick for open session | PR **#1733** (issue #1732) | Navigation cue |
| Combined session-list filter menu | PR **#1772** | Already carries `dogfooded` |
| Discovery callouts for shipped-but-unlabelled controls | PR **#2339** | Content-search scope, sort/filter, title lock |
| Inline model errors (`resource_exhausted` etc.) → surface + notify | PR **#987** (issue #878) | Related producer / row signal |
| Cursor emits `AGENT_NOTIFY_SUMMARY` when Emit status summaries is on | PR **#2354** (issue #2353) | Closes Cursor half left unfinished when #1375 / #1376 shipped without Cursor |

## PRs yet to be lodged

Open issues (or dogfooded local work) that still need an upstream PR. Same umbrella; same
dogfood → merge intent over the next week or two.

| Topic | Issue / basis | Notes |
|---|---|---|
| Blocked affordance: section, rail, jump pill, mark-unblocked | **#1717** | Chrome itself; no PR yet |
| Fold blocked lens into the combined filter menu | **#1996** | Depends on #1772 |
| Active + Working lenses in the filter menu | **#2002** | Already on the local fork filter menu; needs upstream PR |
| Restore row-level fade for non-residency (beside the activity dot) | After `832c5922f` | Dogfooded locally |
| Hub-authored blocker sources for terminal agent errors | Extends #1717 | After blocked chrome |
| Persist last status summary onto session-list fields | Bridges emit → blocked chrome | Producer → list |
| Settings: flag blocked sessions from status summaries (default on) | Below existing emit toggle | Biggest behaviour ask |
| First-use introduction for the blocked affordance | Upstream FUE primitives | Once blocked chrome lands |

## Seams

1. Blocked chrome needs the last status summary on the session row — emit already exists on
   `main` (and #2354 covers Cursor); list persistence and default-on are still open.
2. Fade, job meter, and activity dot all speak to liveness; land in umbrella order so they
   compose on purpose.
3. #1996 and #2002 extend #1772's menu.
4. Prefer always-on chrome over `sessionListStatusMode: detailed`.
5. #1725 / #987 exist so "blocked" and model-error states fire correctly — producer work, not
   badge polish.

## Order

1. Attached jobs — **done** (#1424).
2. Open PRs above (#1725, #1733, #1772, #2339, #987, #2354) — dogfood and merge as each is ready.
3. #1717 blocked chrome (+ hub-authored blockers once it merges).
4. Row-level fade for non-residency.
5. #1772 → #1996 → #2002 (filter chain).
6. Settings default-on + FUE as listed under "yet to be lodged."
