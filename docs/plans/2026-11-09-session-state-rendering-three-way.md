# Session row state rendering — three-way comparison

**Date:** 2026-11-09
**Role:** Full rationale for the coordinated upstream work on **session attention for
multi-session fleets**. Individual PRs under that heading should link back here (or to the
umbrella issue that embeds / cites this).

**Why:** Definitive list of the states a session can be in, and what each of three codebases
draws for them. Prompted by comparing `tiann/hapi#2296` (IanMStevenson) against current
upstream and a live install that has been dogfooding the attention work at fleet scale.

**Sources read directly (no inference):**
- Upstream: `tiann/hapi@main` `web/src/components/SessionRowSummary.tsx` (post `832c5922f`, 2026-11-01)
- Ian: `IanMStevenson/hapi@f67e13905308` same file
- Dogfood tip used for the live comparison: `ff7e86490` same file

---

## Axes a session varies on

1. **Runner presence** — `s.active`. The runner holds the session. Not the same as "doing work".
2. **Agent activity** — `s.thinking` (foreground), `backgroundTaskCount > 0`.
3. **Needs a human** — `pendingRequestsCount`, `attention.kind` (permission / input / background / unread).
4. **Lifecycle** — `metadata.lifecycleState === 'archived'`.
5. **Work / attention chrome** — attached job progress; blocked-with-reason from the last status
   summary. Subject of the coordinated submission.

## Session list status mode

`sessionListStatusMode: 'standard' | 'detailed'`, default `standard` — Settings → Display →
"Session list status". Defined in `web/src/hooks/useSessionListStatusMode.ts` on upstream. It
feeds `showDetailedStatus`, which gates some marker-slot chrome in the dogfood tip:

- schedule tooltip — gated
- background attention indicator — gated
- background spinner — half gated:
  `(showDetailedStatus && attention==='background') || (s.active && bgCount>0)`

Upstream's presence dot and Ian's badge are not mode-gated; both render in `standard`.

## What each codebase draws

| State | Condition | Upstream `main` | Ian #2296 | Dogfood tip (live) |
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

Linked GitHub-issue chips are tracked on a separate track and omitted here.

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

4. **Blocked-with-reason and attached jobs** are live in dogfood and are the body of the
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

## Direction

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

# Part 2 — work under this heading

**Framing.** Managing attention across a large session fleet is the product problem. A substantial
body of that work has already been dogfooded live (1,000+ sessions, ≥~30 active at a time). As
much as possible is already on `tiann/hapi` as issues and PRs. What is still only on the dogfood
install is not a private design — it is **forthcoming upstream work under this same heading**,
and will be opened / linked as PRs against the umbrella issue.

No local branch names below. References are upstream issues/PRs, or "forthcoming under this
heading".

## Already on upstream `main` (foundation)

| Piece | Where |
|---|---|
| `AGENT_NOTIFY_SUMMARY` trailing-line contract | CLI session-summary instruction + settings ("Emit status summaries"); opt-in today |
| Parse / FCM / native companion use of that line | Hub + protocol |
| Work-graph ingest of notify lines | `workGraphNotifyIngest` on hub |
| Activity dots (green working / blue background) | `832c5922f` (2026-11-01) |
| Cursor post-`done` harness silence | #2267 family (merged) |
| Unread list filters / keep-unread-visible | #2292, #2294 (merged; IanMStevenson) |
| Session list sort/filter primitives | #2263 (merged) |

Upstream's own session-summary instruction notes that **Cursor has no system-prompt seam on
stock main**, so the emit toggle covers Claude / Codex / OpenCode / Grok today. Cursor sessions
on a dogfood fleet still emit because a Cursor injection path was arranged locally; **closing
that gap on upstream (or relying on hub-authored blockers when the agent cannot speak) is
forthcoming under this heading** — not a reason to treat status summaries as non-upstream.

## Open upstream (in flight)

| Topic | Issue / PR | Notes |
|---|---|---|
| Session-attached jobs (list chrome, jobs outlive the agent) | Issue #1404, PR **#1424** | Item 1 of the coordinated set; carries `dogfooded` |
| Wake owning session when an attached job completes/fails | Issue **#1489** | Stacks on attached jobs |
| Blocked affordance: section, rail, jump pill, mark-unblocked | Issue **#1717** | Item 2; PR forthcoming / in prep |
| Cursor unexpected-stop → retry then blocked footer | Issue #1724, PR **#1725** | Producer plumbing for blocked |
| Session-list scrollbar tick for open session | Issue **#1732** | Navigation cue |
| Combined session-list filter menu | PR **#1772** | Community PR (techotaku39); `dogfooded` |
| Fold blocked lens into that filter menu | Issue **#1996** | Depends on #1772 |
| Active + Working lenses in the filter menu | Issue **#2002** | Depends on #1772 |
| Discovery callouts for shipped-but-unlabelled controls | PR **#2339** | Item 7; content-search scope, sort/filter, title lock |

## Forthcoming under this heading (dogfooded; not yet separate upstream PRs)

These are live on the dogfood install and belong in the coordinated submission. Each becomes an
upstream PR (or an extension of one above) linked to the umbrella:

| Topic | Intent |
|---|---|
| Residency: restore row-level fade beside the activity dot | Item 4 — fade = not held by a runner (including while a job runs) |
| Hub-authored blocker sources for terminal agent errors | Item 3 — extends #1717's enum; hub speaks when the agent cannot |
| Settings: flag blocked sessions from status summaries | Item 5 — below the existing emit toggle; default on |
| First-use introduction for the blocked affordance | Item 6 — on upstream's existing FUE primitives |
| Persist last notify onto session-list fields (`last_notify_*`) | Producer → list consumer bridge for #1717 |
| Cursor path for status-summary emission on stock upstream | Close the seam called out in upstream's own instruction comment. Dogfood tip still has an uncalled `installCursorNotifyRuleOverlay` (wiring lost); fleet Cursor rows that emit today are not proof that function is live. |
| Operator-hold / needs-operator chip | Related attention chrome; PR under this heading when scoped |
| Resource-exhausted → retry then blocked (Cursor) | Related producer fix; PR under this heading when scoped |

## Seams to resolve as the PRs land

1. **Consumer needs a producer.** Blocked chrome reads the last status summary. The emit
   contract is already on upstream; session-list persistence of that summary, default-on emit,
   and Cursor coverage are the remaining producer gaps (forthcoming above).

2. **Same pixels, several PRs.** Residency fade, job progress, and the activity dot all speak to
   liveness. The umbrella's order is deliberate: jobs → blocked → hub blockers → fade.

3. **Filter menu ownership.** #1996 and #2002 extend #1772. If #1772 does not land, those two
   need another home.

4. **`sessionListStatusMode: detailed` defaults off.** Activity chrome gated on it is invisible
   to default users; prefer always-on for anything in this set.

5. **Producer fragility.** Unexpected-stop retry (#1724/#1725), resource-exhausted handling, and
   hub-authored blockers exist so "blocked" fires correctly — not as UI polish.

## Sequencing (matches the umbrella issue)

1. **#1424** — attached jobs (open).
2. **#1717** — blocked chrome (+ #1725 in parallel).
3. Hub-authored blocker sources once blocked chrome merges.
4. Residency fade beside the existing dot.
5. **#1772 → #1996 → #2002** filter chain.
6. Settings default-on + FUE + discovery callouts (#2339) as listed in the umbrella.

## Not decided in this doc

Exact PR boundaries for the "forthcoming" rows; whether Cursor emission is a dedicated PR or
folded into hub-authored blockers; paste form of Part 1 into the umbrella issue vs link-only.
