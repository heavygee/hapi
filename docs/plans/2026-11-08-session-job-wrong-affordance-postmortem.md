# Postmortem: known-duration dogfood countdown got indeterminate stripes (2026-11-08)

> Incident: PR #1424 dogfood window is a **defined 48h timeframe** ending `2026-11-09T21:20:14Z`. After move onto babysit session `6e70f97b`, list chrome showed the **indeterminate** striped affordance. Operator: that means the feature is not merge-ready. Correct.

## What happened

Peer [job-complete wake](/sessions/b1d1aaf6-8ff7-4552-955b-9f961b6830f0) moved `dogfood-1424-48h` with roughly:

```bash
hapi job run 6e70f97b-… dogfood-1424-48h \
  --label 'dogfood #1424 48h countdown' \
  --detail 'opt-out until 2026-11-09T21:20:14Z UTC; …' \
  --wake-on-terminal --wake-prompt '…' \
  -- sleep 150747
```

No `--remaining`, no `--total`, no `--done`. Child was a pure wall-clock `sleep` of the remaining seconds.

Web rule (`attachedJobFraction` / `SessionRowSummary`):

| Fields present | Text | Bar |
|----------------|------|-----|
| `remaining` + `total` (or `done` + `total`) | fraction / left | **determinate fill** |
| `remaining` alone | `N left · elapsed` | **still indeterminate stripes** |
| label/detail only | `running · elapsed` | **indeterminate stripes** |

So the attach was accepted, heartbeats looked healthy, and the chrome lied about knowledge: a bounded countdown looked like "unknown size."

Babysit later PATCHed `remaining`+`total`+`unit=s` **without** restarting sleep. Affordance type fixed; remaining still **freezes** unless something keeps PATCHing (see below).

## Why this is not "the peer was careless"

The peer followed the **default happy path the product teaches**.

1. **Alive-only is the documented default recipe.**
   - `SESSION_JOB_RUN_RECIPE` (`cli/.../sessionJob.ts`): leads with `Alive-only: hapi job run … -- <cmd>` and explicitly says *no* `--done/--total` on bare `job run`.
   - Guide (`docs/guide/session-jobs.md` § Alive-only): plain `job run` without counts → striped bar. Framed as the normal path when you "do not have a continuous count writer."
   - Skill `hapi-session-jobs` § Honest progress: "Stage only → detail + heartbeats → indeterminate bar" with no special case for **known wall-clock duration**.

2. **A countdown *is* process-shaped work the skill wants on `job run`.**
   Sleep-until-deadline + `--wake-on-terminal` is exactly how Meta/dogfood gates are supposed to wake the babysit. The skill pushes Shell + `job run` hard (MCP `set` refused). Using `sleep N` is the obvious mechanical encoding of "wait until T."

3. **There is no first-class "until / deadline" shape.**
   Hub schema has `remaining` / `done` / `total` / `detail` / heartbeats. No `endsAt` / `--until`. Nothing derives `remaining`+`total` from wall clock. The deadline lived only in **human prose** inside `--detail`, which the UI never parses.

4. **CLI / hub do not refuse the mismatch.**
   `job run` accepts label+detail+sleep with exit 0. No warning when:
   - argv is `sleep <positive int>` (known remaining seconds), or
   - `--detail` matches `/until\s+\d{4}-\d{2}-\d{2}/`, or
   - `--wake-on-terminal` is set on a known-duration child without fraction fields.
   Fail-open: healthy meter, wrong affordance class.

5. **Docs actively scare agents away from the correct bar.**
   Putting `--done 0 --total N` on bare `job run` is called a **wardrobe failure** (frozen 0/N under heartbeats) unless a continuous feeder exists. For a countdown, `remaining`+`total` on launch is honest **only if** something decrements `remaining` (or the product auto-ticks from `endsAt`). Agents under that warning choose alive-only instead of risking a frozen fraction — and get stripes for a known window.

6. **Skill table is incomplete / misleading on remaining.**
   Skill says leftover count → `--remaining N` → `N units left`. It does **not** say the bar stays striped without `total`. Product guide does. Agents reading the skill can believe remaining alone is the countdown affordance.

## Swiss cheese (all slices required)

```text
Known 48h window
        │
        ▼
Encode as sleep N + job run          ← correct process shape
        │
        ▼
Omit remaining+total                 ← taught as default / safe
        │
        ▼
CLI accepts; hub stores; web paints stripes
        │
        ▼
Operator sees indeterminate for a defined timeframe  ← merge-blocker signal
```

Industry UX (Microsoft / Apple / Material): **use determinate when the operation is time-bounded**, even if the estimate is imperfect; indeterminate is for *unknowable* overall progress. Our contract inverted that for the common agent path: bounded countdown → easiest attach → indeterminate.

## What allowed setting that affordance

| Layer | Allowed it? | How |
|-------|-------------|-----|
| CLI `job run` | yes | counts optional; no countdown mode |
| Hub upsert | yes | stores whatever; no affordance class |
| Web | yes | missing `total` ⇒ stripes by design |
| Docs / skill | yes | alive-only is first recipe; countdown not named |
| MCP | n/a | `set` refused; peer used Shell correctly |
| Review / dogfood | failed | move focused on session ownership + wake, not meter class |

## What did not prevent it

- No `--until <iso>` / `endsAt` that auto-maintains `remaining`/`total`.
- No refuse/warn on `sleep N` without fraction fields.
- No refuse/warn when `--wake-on-terminal` + known-duration child lacks `total`.
- No list/API field `affordance: indeterminate|determinate` for agents to assert.
- No dogfood checklist item: "countdown meters must be determinate before Ready YES."
- No continuous remaining feeder wired for sleep-shaped jobs (`hapi-job-run-metered` targets count feeders, not wall-clock countdowns).

## Kill criteria (merge / dogfood)

Call the feature **not Ready** for countdown / dogfood-window jobs until at least one of:

1. **Product:** `hapi job run … --until <iso>` (or `--ends-at`) sets `total` from window length, `remaining` from wall clock, and the babysitter **auto-PATCHes remaining** (or hub derives remaining from `endsAt` on read) so fill does not freeze; **or**
2. **Hard gate:** CLI warns/refuses `sleep <n>` (and similar) without `--remaining`+`--total` (or `--until`); and skill/docs lead with countdown recipe, not alive-only; **and**
3. **Verify:** `hapi job list` / web row for a dogfood window shows determinate fill (or explicit `Ns left` + fill), never stripes, before Meta Ready YES on a dogfood-gated PR.

Alive-only stripes remain legitimate for **unknown-size** batches (beets without a feeder). They are **illegitimate** for "wait until known T."

## Immediate remediation (done / owed)

| Item | Status |
|------|--------|
| PATCH live `dogfood-1424-48h` with `remaining`+`total`+`unit=s` (no sleep restart) | done (babysit) |
| Peer ACK: future countdowns use remaining+total | done |
| Remaining still freezes without updater | **open** — fill class fixed, honesty of % still soft |
| `--until` / auto-tick OR sleep refuse | **owed** before calling countdown UX merge-ready |
| Skill + `SESSION_JOB_RUN_RECIPE` + guide: countdown section; remaining alone ≠ determinate | **owed** |
| Dogfood checklist: assert determinate on window meters | **owed** |

## Not this incident

- Stripe jump / seamless CSS (honesty peer) — separate UI polish.
- False `failed` wake from killing the old timer mid-move — process move bug, not affordance class.
- Lane A / @tiann merge auth — blocked on honesty contract for this job *shape*, not CI green alone.

## Friction (steelman)

**Opposite case:** maybe stripes are honest because without an updater, a fill % would freeze and lie harder. Kill that: Microsoft HIG still prefers determinate for bounded time; the fix is auto-tick / `--until`, not painting "unknown." A frozen wrong % is bad; claiming ignorance when the deadline is in `--detail` and `sleep N` is worse — it trains operators that the Jobs chrome cannot express the primary dogfood gate.

**Cheapest falsification:** attach two meters — (A) label-only sleep 60, (B) `--until` or remaining+total with auto-tick. Operator hard-reload: if A still looks like B, contract is still broken.
