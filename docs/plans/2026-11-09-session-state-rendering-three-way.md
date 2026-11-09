# Session row state rendering — three-way comparison

**Date:** 2026-11-09
**Why:** Definitive list of the states a session can be in, and what each of three codebases
draws for them. Prompted by comparing `tiann/hapi#2296` (IanMStevenson) against current
upstream and the dogfood tree that has been running the attention work.

**Sources read directly (no inference):**
- Upstream: `tiann/hapi@main` `web/src/components/SessionRowSummary.tsx` (post `832c5922f`, 2026-11-01)
- Ian: `IanMStevenson/hapi@f67e13905308` same file
- Dogfood tip: `ff7e86490` same file

---

## Axes a session varies on

1. **Runner presence** — `s.active`. The runner holds the session. Not the same as "doing work".
2. **Agent activity** — `s.thinking` (foreground), `backgroundTaskCount > 0`.
3. **Needs a human** — `pendingRequestsCount`, `attention.kind` (permission / input / background / unread).
4. **Lifecycle** — `metadata.lifecycleState === 'archived'`.
5. **Work / attention chrome** — attached job progress; blocked-with-reason from the last status
   summary. (Landing via the coordinated attention submission; not a separate taxonomy.)

## Session list status mode

`sessionListStatusMode: 'standard' | 'detailed'`, default `standard` — Settings → Display →
"Session list status". Defined in `web/src/hooks/useSessionListStatusMode.ts`. Present on
upstream. It feeds `showDetailedStatus`, which gates some marker-slot chrome in the dogfood tip:

- `:182` schedule tooltip — gated
- `:271` background attention indicator — gated
- `:278` background spinner — half gated:
  `(showDetailedStatus && attention==='background') || (s.active && bgCount>0)`

Upstream's presence dot and Ian's badge are not mode-gated; both render in `standard`.

## What each codebase draws

| State | Condition | Upstream `main` | Ian #2296 | Dogfood tip `ff7e86490` |
|---|---|---|---|---|
| Working | `active && thinking` | green dot on icon, pulsing | green dot, pulsing (`working`) | inline spinner, marker slot |
| Background work | `active && !thinking && bgCount>0` | blue dot, pulsing | blue dot, pulsing (`background`) | blue spinner |
| Idle / waiting | `active && !thinking && !bgCount` | green dot, solid | hollow ring (`waiting`) | nothing rendered |
| Not held by runner | `!active` | no dot, row normal | power mark (`stopped`) | row `opacity-50` + muted title |
| Archived | `lifecycleState==='archived'` | not modelled → reads as `!active` | folded into `stopped` (per his comment) | not modelled → reads as `!active` |
| Needs permission/input | pending / urgent attention | request icon | unchanged from upstream | amber pulsing dot + "pending" label |
| Blocked, with reason | last status summary → blocked | — | — | blocked chip + Blocked section |
| Running attached job | `attachedJob.status==='running'` | — | — | job label + progress meter (row still dims when `!active`) |
| Unread | `sessionIsUnread` | semibold title | semibold title (source changed to `attention.kind`) | semibold title + accent time |

Linked GitHub-issue chips are tracked separately and omitted here.

---

## Findings

1. **Different surfaces.** Upstream and Ian put presence on the agent icon as a corner dot. The
   dogfood tip puts activity in a marker slot beside the title and uses row opacity for not-held.
   Same concepts, three places in the DOM.

2. **Ian's new marks vs current upstream are two**, not four:
   - `waiting` → hollow ring, where upstream draws a solid green dot.
   - `stopped` → power mark, where upstream draws nothing.
   His `working` and `background` match upstream's existing dot states.

3. **Nobody separates archived from not-held.** Ian's comment: *"power mark = stopped or
   archived"*. Upstream and the dogfood tip do not model `lifecycleState` in this file; dimming
   follows `!s.active`.

4. **Blocked-with-reason and attached jobs** appear in the dogfood tip and are the subject of the
   coordinated upstream submission. They are absent from upstream `main` and from Ian's branch
   today.

5. **Residency fade means not held.** Live tip dims on `!s.active` only. A running attached job
   does not keep the row bright; job chrome is its own signal. A job with wake-on-complete brings
   the session back when the work finishes, so RAM is not held for the idle wait.

## Change that landed, and the ask

`832c5922f` (2026-11-01) removed the row-level residency fade and moved liveness to the icon
dot. The coordinated submission keeps that activity signal and proposes further changes on the
same surface: restore residency as a row-level fade, land blocked-with-reason and attached-job
chrome, and put status summaries to use as the producer for "what does it need from me".

## Waiting is not unread

Different predicates:

- `waiting` = `s.active && !thinking && !bgCount` — held by a runner, nothing running.
- `unread` = `sessionIsUnread(...)` — activity the operator has not seen.

A session can be waiting and already read, or waiting and unread. When an agent finishes a turn,
both are often true at once. Unread already has its own affordance in all three trees (semibold
title; dogfood tip also accents the time). Ian's `waiting` ring therefore marks a state unread
already covers for the interesting case, and also fires when the session is idle and already
read.

## Direction (operator decisions already taken)

1. Keep the fade; do not adopt the power mark. Residency is a whole-list scan property.
2. Fade means residency only — including when an attached job is running.
3. Do not adopt the `waiting` ring; unread already carries the useful half of that overlap.
4. Keep upstream's working/background dot colours as the activity axis beside the fade.
5. `832c5922f` removed a row-level residency signal that existed before (`bc543dc49`). The ask is
   to restore a row-level residency affordance, not to import a badge taxonomy.
6. Prefer always-on activity signalling over chrome that only appears in
   `sessionListStatusMode: detailed`.

## What this is for

Liveness matters for outcome, not for decorating activity: when an agent finishes, the list
should show what it concluded and what it needs next. End-of-turn status summaries feed that;
blocked chrome and self-reported next steps are how the list surfaces it.

---

# Part 2 — attention-management surface inventory (operator / soup; not for upstream paste)

**Framing:** residency, activity, and "what it needs from you" land on one row. Layers below each
move one of those; they have not all been reconciled against current upstream in one place before.

## Inventory — soup layers that change how sessions are reported

Extracted from `config/driver-manifest.yaml` on fork main. 19 layers touch this surface.

### A. Residency — "is this taking RAM"
| Layer | Ref | What it does |
|---|---|---|
| `driver/session-row-residency-fade` | cites #1424 | Fade = residency, including when an attached job is running. Operator decision 2026-11-09. Not in #1424's diff. |
| *(upstream)* `832c5922f` | — | Removed the residency fade on 2026-11-01, replaced with an icon-corner dot. |

### B. Activity — "what is it doing right now"
| Layer | Ref | What it does |
|---|---|---|
| `driver/session-job-progress-until` | #1404 → PR **#1424** | Attached-job progress in list chrome; jobs outlive the agent |
| `driver/job-complete-wake` | #1489 | Wake owning session when an attached job completes/fails (opt-in) |
| `driver/slim-session-job-mcp` | (#1424 family) | Job MCP surface |
| `fix/cursor-thinking-flicker-1487` | #1502 / PR #1503 | Cursor ACP chatter was flipping `thinking` every 1–2s — the spinner dance |
| `driver/2002-session-filter-active-working` | #2002 | Active and Working as explicit lenses |

### C. Attention — "what does it need from me, and why"
| Layer | Ref | What it does |
|---|---|---|
| `driver/blocked-list-ux` | **#1717**, #1996 | Blocked section, rail+chip, jump pill — fed by hub-persisted last `AGENT_NOTIFY_SUMMARY` (`sessions.last_notify_*`) |
| `fix/cursor-unexpected-stop-blocked-footer` | #1724 | Auto-Continue once after post-tool interrupt; blocked footer only if that also fails |
| `driver/211-unexpected-stop-notify` | heavygee#211 | Restores the unexpected-stop blocked wire that later layers overwrite |
| `driver/cursor-resource-exhausted-blocked` | heavygee#231 | `resource_exhausted` must retry then stamp Blocked, rather than fail silently |
| `driver/operator-hold-chip` | heavygee#121 | Operator-hold chip (needs_operator / babysit.hold) |

### D. Lenses and filtering — "how do I narrow it"
| Layer | Ref | What it does |
|---|---|---|
| `soup/1772-combined-list-filters` | **#1772 (open upstream)** | Combined filter menu: unread + scratchlist + date |
| `driver/1996-consolidate-blocked-filter` | #1996 | Folds the blocked lens into that menu; removes `BlockedLensToggle` |
| *(merged upstream)* | #2292, #2294 | Keep-unread-visible setting; unread-only filter — both IanMStevenson |
| `sessionListStatusMode` | upstream | `standard` \| `detailed`, default standard |

### E. Navigation
| Layer | Ref | What it does |
|---|---|---|
| `driver/1732-session-list-open-tick` | #1732 / #1733 | Scrollbar-gutter tick showing where the open session sits |

### F. Summary emission — the producer of the attention signal
| Layer | Ref | Note |
|---|---|---|
| `feat/overseer-summary-emit` | fork PR #86/#87 | Manifest: "fork-only, DO NOT upstream" — Cursor emits `AGENT_NOTIFY_SUMMARY` via a transient rule overlay |
| `feat/overseer-open-loops` | fork #100 | "What am I forgetting" lens |
| `feat/overseer-dispositions` | fork #102 | Disposition write path |

---

## Seams that need deciding (operator)

1. **Consumer vs producer.** #1717's blocked chrome reads `sessions.last_notify_*` from
   `AGENT_NOTIFY_SUMMARY`. `feat/overseer-summary-emit` is marked do-not-upstream and is how
   this fleet's Cursor sessions populate that field (**542 / 892** Cursor rows on the live hub
   DB). That does not prove a vanilla upstream install gets the same Cursor coverage. Establish
   what upstream populates `last_notify_*` with before the blocked chrome lands alone.

2. **Same pixels, three layers.** Fade (A), job progress (B), and upstream's dot all speak to
   liveness. Landing order decides the visual unless set deliberately.

3. **`#1996` removes a control `#1717`'s issue text still describes.** Upstream copy must match
   the combined filter menu, not the deleted toggle.

4. **`#1772` is still open upstream** and is the menu #1996 / #2002 extend.

5. **`sessionListStatusMode: detailed` defaults off.** Activity chrome gated on it is invisible
   to default users.

6. **Four layers exist only to make "blocked" fire** (#1724, #211, #231, plus hub blocker
   sources). Producer plumbing is the fragile part; chrome without it looks good and works badly.

## Sequencing

1. **#1424** (attached jobs) — already open.
2. **#1717** blocked chrome + Cursor retry fix — resolve seam 1 first.
3. Hub blocker sources once blocked chrome merges.
4. Residency fade as the row-level ask beside the existing dot.
5. **#1772 → #1996 → #2002** filter chain, gated on #1772.

## Not decided here

Whether / when to paste Part 1 upstream; seam 1 (who populates `last_notify_*` on stock
upstream); exact PR split for residency vs blocked vs jobs.
