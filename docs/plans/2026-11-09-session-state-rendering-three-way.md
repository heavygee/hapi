# Session row state rendering — three-way comparison

**Date:** 2026-11-09
**Why:** Operator asked for a definitive list of the states a session can be in, and what each
of the three codebases actually draws for them. Prompted by `tiann/hapi#2296` (IanMStevenson)
looking like it overlapped fork work when it does not.

**Sources read directly (no inference):**
- Upstream: `tiann/hapi@main` `web/src/components/SessionRowSummary.tsx` (post `832c5922f`, 2026-11-01)
- Ian: `IanMStevenson/hapi@f67e13905308` same file
- Fork soup: `ff7e86490` same file

---

## The axes a session actually varies on

1. **Runner presence** — `s.active`. The runner holds the session. *Not* "doing work".
2. **Agent activity** — `s.thinking` (foreground), `backgroundTaskCount > 0`.
3. **Needs a human** — `pendingRequestsCount`, `attention.kind` (permission / input / background / unread).
4. **Lifecycle** — `metadata.lifecycleState === 'archived'`.
5. **Fork-only work state** — `attachedJob`, `getSessionBlockedState`, `getLinkedGithubIssue`.

## The display-mode axis (easy to miss, and it changes every answer below)

`sessionListStatusMode: 'standard' | 'detailed'`, **default `standard`** — Settings → Display →
"Session list status". Defined in `web/src/hooks/useSessionListStatusMode.ts` and present in
**both upstream and fork** (not a fork invention). It feeds `showDetailedStatus`, which gates
parts of the fork's marker slot:

- `:182` schedule tooltip — gated
- `:271` background attention indicator — gated
- `:278` background spinner — **half gated**: `(showDetailedStatus && attention==='background') || (s.active && bgCount>0)`

So in the **default** mode a fork user sees *fewer* markers than the table below implies.
Neither upstream's presence dot nor Ian's badge is mode-gated — both render unconditionally.
**Consequence: upstream/Ian put liveness in an always-on surface; the fork put parts of it behind
a setting that defaults to off.** That asymmetry is a big part of why the two designs feel
incomparable.

## What each codebase draws

| State | Condition | Upstream `main` | Ian #2296 | Fork soup `ff7e86490` |
|---|---|---|---|---|
| Working | `active && thinking` | green dot on icon, pulsing | green dot, pulsing (`working`) | inline spinner, marker slot |
| Background work | `active && !thinking && bgCount>0` | blue dot, pulsing | blue dot, pulsing (`background`) | blue spinner |
| Idle / waiting | `active && !thinking && !bgCount` | green dot, **solid** | **hollow ring** (`waiting`) | **nothing rendered** |
| Not held by runner | `!active` | **no dot**, row normal | **power mark** (`stopped`) | row **`opacity-50`** + muted title |
| Archived | `lifecycleState==='archived'` | not modelled → reads as `!active` | **folded into `stopped`** by his own comment | not modelled → reads as `!active` |
| Needs permission/input | pending / urgent attention | request icon | unchanged from upstream | amber pulsing dot + "pending" label |
| Blocked, with reason | `getSessionBlockedState` | — | — | blocked chip |
| Running attached job | `attachedJob.status==='running'` | — | — | **exempts row from dimming** |
| Linked GitHub issue | `getLinkedGithubIssue` | — | — | issue chip |
| Unread | `sessionIsUnread` | semibold title | semibold title (source changed to `attention.kind`) | semibold title + accent time |

---

## Findings

1. **Different surfaces, which is why they collide.** Upstream and Ian both put presence on the
   **agent icon** as a corner dot. The fork puts activity in a **marker slot** beside the title and
   uses **row opacity** for not-held. Same concept, three different places in the DOM.

2. **Ian's genuinely new marks are two**, measured against current upstream — not four:
   - `waiting` → hollow ring, where upstream already draws a solid green dot.
   - `stopped` → power mark, where upstream draws nothing.
   His `working` and `background` are upstream's existing dot states, unchanged.

3. **Nobody separates archived from not-held.** Ian's own code comment reads
   *"power mark = stopped or archived"* — he folds them deliberately. Upstream doesn't model
   archived in this file. The fork doesn't either: `SessionRowSummary.tsx` and
   `SessionAttentionIndicator.tsx` contain **zero** references to `lifecycleState`. The fork's dim
   is driven purely by `!s.active && !attachedJob`.

4. **The fork models three things neither upstream nor Ian does:** blocked-with-reason, attached
   jobs, linked issues. These do not exist in upstream or in our own 0.34.4 base
   (`attachedJob` 16 hits on soup / 0 on base; `getSessionBlockedState` 2/0; `IssueRefChip` 2/0).

5. **The fork's one liveness signal carries two meanings.** `opacity-50` is gated on
   `!s.active && !attachedJob`, so a not-held session with a running job renders full-opacity —
   i.e. "undimmed" means *held by a runner **or** carrying live work*.

## Consequence

`SessionRowSummary.tsx` now holds two incompatible visual languages for session liveness, and
upstream is actively changing it (`832c5922f` rewrote it on 2026-11-01). Every future upstream
touch to this file conflicts for the fork. Nobody currently owns whether these converge.

## Is "waiting" just "unread"? — no, but the overlap is the whole argument

They are different predicates:
- `waiting` = `s.active && !thinking && !bgCount` — a runner holds it, nothing is running.
- `unread` = `sessionIsUnread(...)` — there is activity you have not seen.

A session can be waiting-and-read (you looked, nothing new) or waiting-and-unread (the agent
finished and is holding output for you). **The case that actually matters — an agent finished its
turn — is both at once**, and unread *already has its own affordance* in all three codebases
(semibold title; fork adds accent time).

So Ian's `waiting` ring would be a **second mark for a state already signalled**, and it fires on
the uninteresting half of the overlap too (idle *and* already read). That is an argument against
the ring specifically, not against his principle.

## Recommendation (for operator sign-off, not yet acted on)

1. **Keep the fade, drop the power mark.** Residency is a row-scanning property — at ~30 sessions
   a faded row reads instantly and a 2.5px glyph on an icon corner does not. We would also be
   adding a *new* mark for a state the fade already shows. Fade is strictly better here.
2. **Fade means residency, nothing else.** Fixed on the fork side at
   `driver/session-row-residency-fade` — a non-resident session with a running attached job now
   fades, with the job visible through its own chip.
3. **Don't adopt the `waiting` ring.** Unread already carries the signal that matters, and the
   ring fires on the read case too.
4. **Do consider upstream's working/background dot colours** — those are an activity axis, and
   they sit beside the fade rather than replacing it. Taking them costs nothing.
5. **The thing worth arguing upstream:** `832c5922f` *removed* the residency fade (it existed
   before — see `bc543dc49`) and replaced it with a dot. For a multi-session operator that is a
   regression, and Ian's PR is the downstream symptom of it — he is adding marks back to a dot
   because the row-level signal went away. The case to upstream is "residency deserves a
   row-level affordance", not "please take our badge taxonomy".
6. **Rationalise the display-mode split.** Fork liveness partly sits behind
   `sessionListStatusMode: detailed` (default off); upstream's does not. Whatever we keep should
   be always-on, or the signal is invisible to default users.

## The point this all serves

The reason liveness matters here is **outcome**, not activity: when an agent finishes we need to
know *what it concluded and what it needs next*. That is what the end-of-turn summary and
next-steps emission feeds, and what lets sessions be surfaced by blocked status and by what they
say about themselves. Any state taxonomy that does not serve that is decoration.

---

# Part 2 — the full attention-management surface

**Operator framing (2026-11-09):** *"It's all about attention management."* The session row is not
three competing badge designs; it is the single place where **residency**, **activity**, and
**what a session needs from you** all have to land at once. A pile of fork layers are about to be
dogfooded and upstreamed that each move one of those three, and they have never been reconciled
against each other or against current upstream. That reconciliation is the point of this document.

## Inventory — soup layers that change how sessions are reported

Extracted from `config/driver-manifest.yaml` on fork main. 19 layers touch this surface.

### A. Residency — "is this taking RAM"
| Layer | Ref | What it does |
|---|---|---|
| `driver/session-row-residency-fade` | fork-only, cites #1424 | Fade = residency, **not** "has attached job". Operator decision 2026-11-09. Not in #1424's diff. |
| *(upstream)* `832c5922f` | — | **Removed** the residency fade on 2026-11-01, replaced with an icon-corner dot. |

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
| `driver/blocked-list-ux` | **#1717**, #1996 | Blocked section, rail+chip, jump pill — **fed by hub-persisted last `AGENT_NOTIFY_SUMMARY` (`sessions.last_notify_*`)** |
| `fix/cursor-unexpected-stop-blocked-footer` | #1724 | Auto-Continue once after post-tool interrupt; blocked footer only if that also fails |
| `driver/211-unexpected-stop-notify` | heavygee#211 | Restores the unexpected-stop blocked wire that later layers overwrite |
| `driver/cursor-resource-exhausted-blocked` | heavygee#231 | `resource_exhausted` must retry then stamp Blocked, rather than fail silently |
| `driver/operator-hold-chip` | heavygee#121 | Operator-hold chip (needs_operator / babysit.hold) |

### D. Lenses and filtering — "how do I narrow it"
| Layer | Ref | What it does |
|---|---|---|
| `soup/1772-combined-list-filters` | **#1772 (open upstream)** | Combined filter menu: unread + scratchlist + date |
| `driver/1996-consolidate-blocked-filter` | #1996 | Folds the blocked lens into that menu; **removes `BlockedLensToggle`** |
| *(merged upstream)* | #2292, #2294 | Keep-unread-visible setting; unread-only filter — **both IanMStevenson** |
| `sessionListStatusMode` | upstream + fork | `standard` \| `detailed`, **default standard** |

### E. Navigation
| Layer | Ref | What it does |
|---|---|---|
| `driver/1732-session-list-open-tick` | #1732 / #1733 | Scrollbar-gutter tick showing where the open session sits |

### F. Summary emission — the *producer* of the attention signal
| Layer | Ref | Note |
|---|---|---|
| `feat/overseer-summary-emit` | fork PR #86/#87 | **Manifest says "fork-only, DO NOT upstream"** — Cursor emits `AGENT_NOTIFY_SUMMARY` via a transient rule overlay |
| `feat/overseer-open-loops` | fork #100 | "What am I forgetting" lens |
| `feat/overseer-dispositions` | fork #102 | Disposition write path |

---

## The seams that need deciding

1. **We are about to upstream a consumer of a signal whose producer we keep fork-only.**
   #1717's blocked chrome reads `sessions.last_notify_*`, persisted from `AGENT_NOTIFY_SUMMARY`.
   The fork's emission layer is marked *do not upstream*. **Before PR A ships, establish what
   upstream populates that field with** — if the answer is "nothing", the feature lands upstream
   inert and we will have shipped chrome with no data behind it. *Open question, not yet checked.*

2. **Three layers each claim the same residency/activity pixels.** The fade (A), the job progress
   chrome (B), and upstream's dot all render liveness. Order of landing decides who wins by
   accident unless we decide deliberately.

3. **`#1996` deletes a control `#1717`'s own issue text describes.** The blocked-lens toggle is
   gone, folded into the combined menu. Whatever goes upstream must describe the *current* control.

4. **`#1772` is still open upstream** and is the menu that #1996 and #2002 both extend. If #1772
   does not land, two of our filter layers have no home upstream.

5. **The display-mode split (§ display-mode axis) hides part of our activity signalling by
   default.** Anything we upstream should be always-on or it is invisible to default users.

6. **Four separate layers exist only to make "blocked" fire correctly** (#1724, #211, #231, plus
   the hub blocker sources in PR B). That is not UI polish — it says the *producer* side is where
   the real fragility is. An upstream submission that ships the chrome without that plumbing will
   look good and work badly.

## Sequencing recommendation

1. **#1424** (attached jobs) — Ready YES, waiting on @tiann. Lands the activity/job axis first.
2. **#1717 PR A** (blocked chrome) + standalone Cursor retry fix in parallel — resolve seam 1 first.
3. **PR B** (hub blocker sources) once A merges.
4. **Residency fade** — fork-side now; upstream only as the argument in seam 7 below.
5. **#1772 → #1996 → #2002** filter chain, in that order, gated on #1772 landing.

7. **The upstream argument worth making, once the above is coherent:** `832c5922f` removed a
   row-level residency signal that existed before it. For an operator running ~30 concurrent
   sessions that is a regression, and #2296 is the visible symptom — a contributor adding marks
   back onto a dot because the row-level signal went away. The ask is "residency deserves a
   row-level affordance", supported by the attention-management case above.

## Not decided here

Whether to raise this upstream and in what form; seam 1 (who populates `last_notify_*` upstream);
and whether the fork converges with upstream on `SessionRowSummary.tsx` or accepts permanent
divergence.
