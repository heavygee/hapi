# ContributionState as Overseer sensor

> **Status:** framing note (not a build ticket). Captures the principle behind `hapi-meta-daily` before it gets mistaken for either (a) Overseer itself or (b) a premature generic product. **The write path this note argues for now exists** — `POST /api/system-events` shipped into the soup 2026-07-25; see the ingest spec's "Slice A: landed in soup".
> **Date:** 2026-07-25
> **Audience:** Meta PR watcher, Overseer peers, anyone tempted to "generalize the daily dance."
> **Companions:** [`2026-06-03-overseer-framing.md`](./2026-06-03-overseer-framing.md), [`2026-06-03-overseer-contracts.md`](./2026-06-03-overseer-contracts.md) (§1 SystemEvent, §8 channels), [`2026-07-25-github-pr-awareness-optin-and-attachment.md`](./2026-07-25-github-pr-awareness-optin-and-attachment.md) (opt-in gate + explicit session↔PR binding), [`docs/operator/AGENTS.md`](../operator/AGENTS.md) § Meta PR watcher.

---

## Direct answer (read this first)

**Today, running `hapi-meta-daily` does *not* emit events for the Overseer.**

What it does today:

| Layer | Behavior |
|-------|----------|
| **Actuate (local fleet)** | Cache status on PR chips (`externalRefs`); strip leftover title emoji; policy-ping peers when status transitions / sticky ⚠️🔧 remind |
| **Surface (operator)** | Print a sorted action queue + GitHub comms digest to stdout |
| **Remember (local)** | Persist last-emoji / fingerprint / ping time / notif cursor under `~/.local/state/hapi/meta-daily.json` |
| **Emit into Overseer substrate** | **None.** No row in `events`, no inbox candidate, no SystemEvent |

The "sensor for Overseer" idea is **aspirational**: the same classification that drives today's renames/pings *should later* also write typed events so a fleet Overseer can answer "what's blocking our contribs to `tiann/hapi`?" without Meta reinventing the sweep in prose every morning.

Until that land, Meta *is* the stand-in arm/brain - a human-invoked CLI doing both "move agents forward" and "tell the operator the state." Those two jobs will split:

```
                    ┌─────────────────────────────┐
   GitHub + hub ──► │  ContributionState sensor   │
                    │  (classify, fingerprint,    │
                    │   identity-namespaced)      │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                 ▼
   Actuation (today)                    Observation (future)
   rename + policy-ping                 SystemEvent emission
   (Meta / meta-daily)                  attention_candidate 0|1
                                        → Overseer inbox
```

Do **not** conflate the two. Actuation without observation is what we have. Observation without actuation is what channels (#19) and hub-observed synthesis already plan. Both together is the end state - still not "Overseer," still not a new product.

---

## What ContributionState is

A **deterministic, idempotent reading** of:

> For contributor `C` against repo `R` (optionally bound to a local worker fleet): what is open / blocked / waiting-on-maintainer / merged-needing-cleanup / orphaned / needing human reply?

Inputs (repo-agnostic in principle):

- Open PRs authored by `C` on `R`
- Recently merged / closed-unmerged PRs in a lookback window
- Review threads, CI checks, bot findings, mergeability
- Notification stream for `R` (and sibling fork, if any) since a cursor
- Optional **bindings**: local worker sessions, worktrees, soup layers, issue trackers

Outputs:

- Per-contribution disposition (emoji contract today; typed `event_type` tomorrow)
- Action fingerprint (stable hash of disposition + instruction) for transition detection
- Action queue for a human or Overseer
- Optional side effects: retitle, ping, emit

HAPI is the first binding (`session ↔ PR ↔ soup layer ↔ :3006 hub`). The shape is wider; the package is not.

---

## What it is not

| Temptation | Why not |
|------------|---------|
| **Overseer itself** | Overseer = attention arbitration across workers ([framing](./2026-06-03-overseer-framing.md)). ContributionState is one *input channel*, same tier as `AGENT_NOTIFY_SUMMARY` or session health - not the conversational chief of staff. |
| **Vigil / pr-shepherd / finalize-pr** | Those are **actuation** loops (fix CI, rebase, reply). We deliberately observe + advise + policy-ping, then stop. Merges, soup edits, worktree deletes stay operator/peer judgment. |
| **A standalone miniproject / npm package** | One consumer (HAPI Meta) today. Extracting a generic library before a second binding or Overseer ingest exists is premature abstraction wearing a product hat. |
| **Channels (#19) replacement** | Contracts already say external sources emit as `source_kind=channel`. ContributionState is a *specialized* channel producer for "my contribs to R," not the general Discord/calendar/GitHub-issue pipe. |

---

## Identity: the cross-wiring kill-criterion

Incident 2026-07-25: lowering PR-number extraction to 2 digits matched overseer workstream titles (`W1.6 provenance (#22)`) to unrelated upstream `tiann/hapi#22`, mass-mislabeling the fleet.

**Rule:** contribution identity is always namespaced.

```
{host}/{owner}/{repo}#{number}     e.g. github.com/tiann/hapi#803
```

Bare `#803` is a *display* token inside a known binding, never a global key. Internal workstream numbers, peer ticket IDs, and fork PR numbers that collide with upstream must not share a namespace. Today's 3-4 digit floor on HAPI session titles is a local hack; the durable fix is namespaced IDs in state + events.

Kill-criterion for any generalization: if two distinct contributions can produce the same dedupe key, stop shipping.

---

## Mapping onto existing Overseer contracts

Do not invent a parallel event world. Fit the sensor into what contracts already specify.

### Today → tomorrow event sketch

| meta-daily disposition | Likely `event_type` | `attention_candidate` | Notes |
|------------------------|---------------------|----------------------|--------|
| ⚠️ needs work (CI/threads/bot/rebase) | `blocked` or `needs_decision` | 1 | Prefer `blocked` when a worker owns it; `needs_decision` when only operator can unblock (e.g. closed-unmerged) |
| 🔧 merged | `completed` + `operator_action_required=true` | 1 | Artifact: soup-layer drop / worktree cleanup; not "archive now" |
| ✅ green waiting on maintainer | `progress` or low-severity `needs_decision` | 0 or 1 (policy) | Default **0** - do not nag Overseer daily that tiann hasn't merged |
| 🔁 CI in flight | `progress` | 0 | Captured-only; re-classify when checks settle |
| 📝 pre-PR | `progress` | 0 | Unless binding says "file by date X" |
| New human GitHub comment/mention | `needs_decision` | 1 | Matches channels example: external → via-overseer |
| `?` data unavailable | *(no emit)* | - | Never invent attention from missing data |

`artifact_refs`: always include `{kind:"github_pr", url, title, source:"external"}` (contracts already list `github_pr`).

`dedupe_key`: `contrib:{namespaced_id}:{emoji_or_type}` so sticky ⚠️ does not mint a new inbox item every morning - only fingerprint change or severity bump does. Mirrors today's ping policy.

`provenance`: `hub-inferred` / `external` - this is hub-observed synthesis (build-sequence Step 2), not worker self-report. That matters for contradiction handling (contracts §14): worker says "I'm green," sensor says CI fail → surface the conflict, don't pick a winner.

### Where it sits in the build sequence

- **Not MVP.** Build-sequence MVP non-goal: *"No channels integration (#19 deferred). External sources don't emit into events yet."*
- Natural home: **post-MVP channel producer**, or a thin hub-observed synthesizer that runs on a timer / Meta cron and writes events without waiting for full channels plumbing.
- Until then: Meta keeps running the CLI; the action queue *is* the inbox, printed.

---

## Observe vs actuate (hard boundary)

| Always allowed for the sensor | Never automatic |
|-------------------------------|-----------------|
| Classify, fingerprint, write state | `gh pr merge` on upstream |
| Emit SystemEvents (future) | Soup manifest edit / driver rebuild / hub restart |
| Retitle session to match disposition | Delete worktree / branch |
| Policy-ping owning session | Archive session mid-turn |
| Print / return action queue | Reply on GitHub / mark notifications read |

Actuation that *moves agents forward* (rename + ping) stays Meta's job until Overseer Stage 1+ dispatch exists - and even then, one-boss (ADR-001): the worker sees an operator-attributed message, not "Overseer said so."

---

## When (if ever) this becomes a miniproject

Greenlight extraction **only if** one of:

1. A **second binding** exists (another repo where the same classifier + policy produces a weekly-useful queue without HAPI sessions), or
2. Overseer (or hub synthesizer) **subscribes** to ContributionState output as SystemEvents,

…and the namespaced identity + observe/actuate boundary are already in tests.

Otherwise: keep improving `hapi-meta-daily` + `lib/pr-emoji-core.sh` in-tree. Principle documented; package deferred.

Falsification (cheapest):

- Point the classifier at one non-HAPI repo for a week. If the queue is not useful without session bindings, the "wider principle" is still a HAPI sensor.
- Ask Overseer Step N: schema ingest or just "Meta runs a CLI"? Schema → substrate work. CLI → stop at this note.

---

## Current entrypoint (do not reinvent)

```bash
cd ~/coding/hapi && ./scripts/tooling/hapi-meta-daily.sh
```

Canon: `docs/operator/AGENTS.md` § Meta PR watcher. Core policy: `scripts/tooling/lib/pr-emoji-core.sh`.

---

## Revision, same day: substrate audit moves the answer

The "defer until a second binding or Overseer ingest" conclusion above was written **before** auditing what is actually live. Audit findings (2026-07-25, driver soup on `:3006`):

| Capability | Status | Where |
|---|---|---|
| `events` table, full contract schema | **LIVE in soup** | `driver/hub/src/store/events.ts` `ensureOverseerEventsSchema` |
| `insertSystemEvent` with **server-side idempotency dedupe** | **LIVE** — returns existing row when `idempotency_key` matches | `store/events.ts:153` |
| `related_session_id` on events | **LIVE** | schema + `repointSessionEvents` |
| `dedupe_key`, `provenance`, `artifact_refs`, `attention_candidate`, `severity` | **LIVE** | schema |
| Hub-side synthesizer | **LIVE** | `sync/overseerEventRecorder.ts` |
| Read-only Overseer query tools + replay harness | **LIVE** | `web/routes/overseer.ts`, `overseer/replayHarness.ts` |
| **HTTP ingest for an external sensor** | **MISSING** | routes are `GET identity`, `GET voice`, `POST tools/:tool` (read-only), `POST convo-turns` |
| `source_kind` values in use | only `'system'`, `'worker'` | no `'external'` producer yet |

Two of the three hard problems are **already solved by the substrate**:

1. **Attach-to-session** — `related_session_id` means an external GitHub signal is not a free-floating "channel" item; it binds to the exact worker session whose work it concerns. This is precisely the operator's point: the bot/human comment *is* an event about that session's work, and the schema can already say so.
2. **Daily re-run duplication** — `idempotency_key` dedupe is server-side. `hapi-meta-daily` already computes a stable action fingerprint. These were built for each other without knowing it.

### The argument that makes this non-optional

**An Overseer that only hears workers is a yes-man.** Contracts §14 (contradiction surfacing) requires an independent ground truth: worker claims green, CI says fail → surface the conflict. Today every event in the table originates from worker self-report or hub process observation. There is **no external ground-truth producer**. ContributionState is the natural one. Without it, contradiction handling has nothing to contradict *with*.

### What is genuinely blocking (be honest)

Not roadmap sequencing — that was a weak objection. The real blockers:

- **No write path.** A bash CLI writing directly into the live hub's SQLite is not acceptable (lock contention, bypasses validation, and `driver/` is reset by every rebuild). This needs a small hub ingest route.
- **Taxonomy risk.** Contracts: *"Bad event semantics will poison the Overseer."* Defaults must be conservative; the open questions below are not yet answered.
- **Stack depth.** Overseer fork PRs #54, #55, #56, #57, #81, #86, #87, #88, #91 are all **open**. #87's fallback layer carries an active event-spam KILL-CRITERION. Adding a producer while the consumer stack is unmerged risks polluting the corpus the prioritizer will be tuned on.

### Revised recommendation: emit transitions, not state

`hapi-meta-daily` already computes the right thing to emit. Its ping policy (**transition** / fingerprint change / reminder) *is* an attention-promotion policy — same function, different sink. So:

- **Emit on transition only**, never on steady state. A ⚠️ that is still ⚠️ with the same fingerprint emits nothing. Volume becomes a handful of events per day, each meaningful.
- `idempotency_key` = existing action fingerprint (+ date bucket for reminders). Re-runs are no-ops by construction.
- `source_kind: 'channel'`, `provenance: 'contrib-state@meta-daily'` — never `'worker'`, and **never invent a parallel `'external'` sourceKind** (that string is wrong; `channel` is already in the typed soup enum and contracts §10). Keep `source: 'external'` only on *artifact_refs* entries (contracts already have that field).
- `related_session_id` = owning session when known; null for orphan PRs (still valuable: "PR with no owner").
- Conservative `attention_candidate`: **1** only for ⚠️-with-owner, human comment/mention, and 🔧-merged-needing-cleanup. **0** for ✅/🔁/📝 and all steady state.
- Never emit on `?` (data unavailable). Missing data must not manufacture attention.

Smallest correct slice: hub ingest route accepting `source_kind='external'` + meta-daily `--emit-events` flag (off by default until the consumer stack settles).

**Revised verdict:** the principle is right and the substrate is readier than this doc first claimed. Still **not** a standalone miniproject — but ContributionState should become the **first external event producer** in this estate, as an overseer slice, not as a bash-to-SQLite hack. Sequence it against the open overseer stack rather than adding a 10th unmerged layer blind.

**Buildable spec (next step):** [`2026-07-25-contrib-state-event-ingest-spec.md`](./2026-07-25-contrib-state-event-ingest-spec.md) — hub `POST /api/system-events` (channel-only) + `hapi-meta-daily --emit-events`, tied to ancestor session [State indicators based on PR state](/sessions/fc561649-e783-4a56-be5e-3ca7511c1663) (2026-06-16 dual-target babysit framing; the planned contracts addendum that was never written).

---

## Open questions (do not resolve in this note)

1. Should ✅ "waiting on tiann" ever be `attention_candidate=1`, or only after N days stale?
2. ~~Fork PRs on `heavygee/hapi` vs upstream `tiann/hapi` - one ContributionState stream or two bindings?~~ **Resolved 2026-07-25 (ancestor session concurrence):** one producer, two `pr_targets` in one binding — not two streams.
3. Emission path: Meta CLI writes events via hub API, or a separate synthesizer cron owned by hub?
4. How does soup-layer ownership attach to `artifact_refs` without leaking fork-private paths into upstream-visible events?
