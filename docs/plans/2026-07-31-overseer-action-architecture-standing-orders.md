# Spec: Overseer action architecture - dispositions, tombstones, standing orders

> **Status:** SPEC / frozen shape 2026-07-31 (operator-blessed, ready to plan into bricks).
> **Owner:** 🔁overseer prep (converse/entity layer) — most of this lives there.
> **Ingest/scoring touchpoints:** feature peer (this session) — disposition records feed the
> priority/learning model; the discovery watcher and causal poll filter sit near the events
> store + scoring where the ingest peer already works.
> **Companions:** `2026-07-30-overseer-inbox-pr-notif-title-and-scoring.md` (§ Handoff H1-H4),
> `2026-07-31-overseer-forgotten-open-loops-lens.md`.

## Vision (operator, verbatim intent)

Morning coffee. "Overseer, what's up?" -> briefing of the top items. "What's that one about?"
-> backstory + why-now. Operator gives an opinion, asks what's next, moves on. Over time the
operator is bothered with **fewer and fewer decisions**, because recurring classes of decision
get delegated to standing orders and handled as **notification, not decision**.

The Overseer is a **secretary / exec assistant, not a chief of operations.** She conveys intent,
routes to the capable agent (who has total salience because they raised it), relays clarifying
questions back. She is explicitly **not** a deep thinking model and never recommends *what to do*
on her own — she defers to the agent's expertise. Radar O'Reilly, not Klinger: she knows what
the operator would say for a slew of routine things and executes them, then leaves the carbon
copy on the desk.

## Core principles (the shape)

1. **Secretary, not COO.** The Overseer routes and records; she does not solve. This is *why* her
   context budget survives — delegation is a pointer-pass, not a context-transfer.
2. **Human ON the loop, not IN it.** The operator authors a policy *once*; matching instances
   execute without a per-instance confirm. The judgment happens at authoring time (Potter signs
   "requisitions under $50" once; Radar executes the hundred). Auto-fire is safe not because a
   human blesses each instance but because a human wrote the bucket and the match is mechanical.
3. **The brain never invents judgment.** The 27B (flaky on `tool_choice`, narrates from memory —
   see `converse.ts`) never *authors* a policy or *invents* an autonomy tier. It matches an event
   to an existing operator-authored rule and fires the canned action. Novel / ambiguous -> `ask`.
4. **Rank sorts the stack; causality earns the interrupt.** High priority earns a good seat in
   the queue, not the right to barge into the current conversation.
5. **The needle-mover is the ability to ACT.** Operator (2026-07-31): a read-only version won't
   move the needle — the value is *doing* stuff, not just talking about it. The read-only phases
   below are cheap falsification gates to pass *through* quickly, not milestones to rest on. The
   destination is the write-path and the actuator.
6. **Earn the leash.** That said, nothing *auto*-fires until a suggest-only pass has proven its
   buckets are sane. Fast to the write-path; measured on the auto-pilot.

## Keystone primitive: the Disposition (the write-path)

Every operator decision on an item becomes a recorded row (`inbox_operator_actions`:
`item_id`, `action`, `feedback`, `ts`). **One object, three faces:**

- **Source of truth** — the durable decision record.
- **Tombstone** — its one-line rendering dropped into the conversation
  (`item X (about Y) -> decided Z`), which lets the converse loop collapse all the context that
  led to the decision. Rehydration is one tool call away (`query_events { sessionId }` +
  `explain_priority`). **The write IS the tombstone trigger** — no fuzzy "did we decide?"
  classifier; a decision exists exactly when a disposition is recorded.
- **Learning label** — the schema already calls these "training labels." Aggregated over time
  they teach the priority model the operator's actual triage taste, and they are the raw material
  the discovery engine mines for standing orders.

**Nothing else in this spec works without this brick.** Build it first. Today the table has ~0
rows because nothing writes it conversationally (chicken-and-egg for discovery, below).

## Autonomy tiers (the "what," not just the "how")

A standing order encodes the *decision* for a bucket, at one of three tiers:

| Tier | Behavior | Gate |
|------|----------|------|
| `notify` | Auto-handle + FYI tombstone (Radar signs, tells you after) | in-policy AND reversible AND low blast radius |
| `propose` | The Overseer surfaces the canned answer; operator one-taps | in-policy, but consequential or not-fully-reversible |
| `ask` | Full decision surfaced to the operator | **default** for anything unbucketed |

Gating axes: **reversibility** (two-way door vs one-way door) × **blast radius** × **in an
operator-authored bucket**. Prior art to stand on: Dependabot (auto-merge patch, ask on major),
and HAPI's own graduated permission modes (`default / acceptEdits / auto / bypassPermissions /
plan`, `shared/src/modes.ts`) — standing orders are that same "dial the leash by trust" idea
applied to *triage decisions* instead of *tool calls*.

## Standing orders (the policy layer)

A standing order = **(bucket predicate) -> (tier, canned action)**. Bucket predicates match on
event features already in the store: `sourceKind`, `eventType`, `category`, repo/artifact,
provenance. Example: `{ sourceKind: channel, artifact.repo: tiann/hapi, eventType: progress }
-> notify: resolve`.

Authored by the **operator**, matched (not authored) by the Overseer. This is the "more nuance about
the what" — the policy carries the decision, the Overseer just recognizes the bucket.

## Standing-order discovery (the "progressively surface fewer" engine)

Watch the accumulated dispositions for **repeated identical decisions on a recognizable bucket**
and *offer* to promote them: "you've resolved 'tiann PR notif' 14 times — make it a standing
order at `notify`?" The operator authors by confirming the offer. **It never mints policy
silently.** This is the path *toward* auto-handling, earned from the operator's own repeated
decisions rather than guessed.

**Chicken-and-egg:** discovery needs disposition data, which needs the write-path. So discovery
is strictly downstream of the keystone. (A cheaper pre-flight exists — retrospective bucket
analysis over *existing events* — see Phase 0.5.)

## Delegation (rides the same tiers, reuses `ping-peer`)

"Tell X's agent to do Z" is just a disposition whose action is a **relay** instead of a resolve.
The dispatch primitive already exists estate-wide: `hapi-ping-peer` resumes inactive peers, waits
for active, POSTs the intent. The Overseer conveys intent; the agent has total salience and rehydrates
its own context; the Overseer keeps a tombstone (`relayed 'do Z' to X's agent, awaiting`). Her cost is
~constant per dispatch regardless of task depth — the secretary model in action. Clarifying
questions are an async relay back to the operator. Same three tiers gate whether a dispatch is
auto/propose/ask.

## poll-on-turn (agent finished while we were talking)

Two tiers, scoped by **causality, not rank**:

- **Interrupt tier ("oh by the way"):** events from a session we dispatched to *this
  conversation*, or the item currently in focus. Surface as a light interjection. The query is
  inherently tiny — `query_events { sessionId, sinceTs }` for only the handful of sessions we
  touched this conversation, lean projection, **meaningful transitions only** (completed /
  blocked / needs_decision — not progress chatter).
- **Ambient tier (silent stack accretion):** everything else, *even high-priority* (e.g. an
  automated hourly process emitting events). It rises to the **stack tip** for the next
  "what's next?" but does **not** barge into the current flow.

Causal key: provenance / `relatedEventId` chains / "did this event come from a session this
conversation dispatched to or is discussing." An hourly-cron event is high-rank but causally
unrelated -> waits at the tip. The completion from the agent you dispatched two minutes ago is
maybe lower-rank but causally ours -> earns the "oh by the way."

## Context budget

Tombstones collapse decided items to a few tokens; rehydration is one tool call away. Combined
with the H2 lean projection + the 16k per-tool-result clamp, a coffee-length conversation stays
well inside the 64k window. No summarize-engine needed at this stage — the disposition tombstone
*is* the summarizer for the only turns worth compacting (the ones that reached a decision).

## Safety invariants (non-negotiable)

- The brain never authors policy or invents an autonomy tier. Match-and-execute only; novel /
  ambiguous -> `ask`.
- `notify`-tier auto-handling requires: an **operator-authored** standing order **AND** a
  reversible action **AND** low blast radius.
- Everything auto-handled leaves a **tombstone + one-step undo + audit trail**.
- Discovery **suggests**, never **enacts**. Promotion to a standing order is an explicit operator
  confirmation.

## Phasing

The needle-mover is the write-path and the actuator; read-only talking does not move it. The
read-only steps below are cheap falsification gates — pass through them fast, don't linger.

- **Phase 0 (live):** read-only briefing + drill-in (H1 on PR #100). "What's up / what's that
  about" already works once souped. This is table stakes, not the goal.
- **Phase 0.5 (cheapest gate, optional):** retrospective bucket analysis over *existing* events —
  no writes needed. Uses data already on hand (the 174-item inbox was 73% FINALE, ~25 bare-URL PR
  notifs). **Kill-criterion:** if recurring events don't cluster into clean, describable buckets,
  the standing-orders premise is falsified here for near-zero cost. Skip it if confident.
- **Phase 1 (keystone — first thing that moves the needle):** manual disposition write-path +
  tombstone. Crosses read -> write; human-in-the-loop per instance (no policy yet). The operator
  can now actually *clear items* over coffee, and it generates the decision data everything else
  needs.
- **Phase 2 (suggest-only gate):** discovery engine watches accumulated dispositions and *proposes*
  buckets, enacting nothing. **Kill-criterion:** watch ~2 weeks; if the buckets are noise, kill
  before building the auto-pilot. Short soak — this is a checkpoint, not a destination.
- **Phase 3 (the actuator):** graduated auto-handle (`notify` / `propose`) on operator-approved
  standing orders, with tombstone + one-step undo + audit. Delegation (`ping-peer`) lands here or
  as its own brick. **This is where the needle really moves** — recurring administrivia handled as
  notification, not decision.

## Ownership split

| Brick | Owner |
|-------|-------|
| Disposition write-path (conversational), tombstone rendering, autonomy-tier execution, poll-on-turn, delegation via ping-peer, system prompt | 🔁overseer prep (converse/entity) |
| Disposition records feeding priority/learning; standing-order **discovery watcher**; causal poll filter over events provenance; Phase 0.5 retrospective bucket analysis | ingest/scoring peer (this session) |

## R8 — disposition snapshot column contract (ingest peer proposal, evidence-based)

R8 (overseer prep): freeze a denormalized snapshot of the as-seen event features **on the
disposition row at write time**, because events get re-scored and discovery must cluster on what
the operator *saw*. Makes P2 a `GROUP BY`. **The deep invariant:** these columns are one shared
vocabulary — *snapshot columns ≡ standing-order predicate fields ≡ discovery GROUP BY keys.* If
they diverge, discovery suggests buckets you can't express as policy, or policy matches on axes
you never clustered on.

**Proposed set — discrete predicate columns** (indexable, clean `GROUP BY`; these ARE the
standing-order match keys):

| Column | Source | Why (validated on live DB, P0.5 below) |
|--------|--------|-----|
| `source_kind` | event | worker / system / channel — top-level discriminator |
| `source_ref` | event | which specific source (`contrib-state:tiann/hapi`, `peer`, machine) |
| `event_type` | event | blocked / needs_decision / completed / stale / … |
| `category` | inbox item | the as-seen grouping (snapshot — the map may drift; dispositions already cluster on it) |
| `project` | payload `$.session.project` | 63 projects; per-project standing orders are prime (hapi 776, server-setup 355, lockhouse 350 …) |
| `artifact_kind` | artifact_refs[0].kind | github_pr / github_issue / null |
| `repo` | artifact_refs[0].repo (or parsed URL) | bucket by repo (all channel = `tiann/hapi`) |

**Plus `context_snapshot_json`** (blob, as-seen, for the R3 tombstone render + audit + future keys):
`title`, `summary`, `severity`, `base_priority`/`priority`, `provenance`, full `artifact_refs`,
source event ids. Not GROUP BY keys; a new bucket axis graduates from the blob to a discrete
column later via deterministic backfill.

`provenance` stays in the blob (audit: `AGENT_NOTIFY_SUMMARY`, `contrib-state@meta-daily`,
`hub-inferred …`) rather than a predicate key — `source_kind` + `source_ref` already carry the
matchable producer identity.

## P0.5 — retrospective bucket analysis (live DB `/var/lib/hapi/hapi.db`, 2026-07-31)

Ran read-only over 4848 events / 183 inbox items / **11 existing dispositions** (not zero). Buckets
cluster cleanly on the R8 columns — the standing-orders premise holds. Top candidate buckets to
seed the operator's first **hand-authored** standing orders (before discovery exists):

- **B1 — routine upstream PR progress:** `channel / tiann/hapi / progress` (`contrib-state@meta-daily`),
  72 events. The 📝/🔁 flood. Candidate tier: `notify:resolve` (or suppress). This is the exact
  thing #99 de-prioritized; a standing order retires it entirely.
- **B2 — worker completed:** `worker / completed`, 1601 events -> FINALE. Already handled by F5
  auto-resolve.
- **B3 — dead hub-inferred stale:** `system / stale` (`hub-inferred from session silence threshold`),
  656 historical, **newest 2026-07-17** (stopped 14d ago), recent ones `attention_candidate=0`.
  Candidate: operator-approved one-shot historical cleanup (NOT the live sweep — see F5 correction).
- **B4 — PR babysit lifecycle:** `channel / tiann/hapi / {blocked,completed,needs_decision}`,
  ~76 events. Keep, but demoted (#99 channel band).
- Existing 11 dispositions already cluster: `done` on QUESTION(4)/BLOCKED(3), `open` on
  QUESTION(2)/BLOCKED(1), `dismiss` on QUESTION(1) — the write-path + GROUP BY shape works today.

**Stale reconciliation (corrects the earlier "0 stale events" shorthand):** two different things
share `event_type='stale'`:
1. **hub-inferred silence** (`source_kind=system`, "No agent output for 30 minutes") — the retired,
   wrong-headed concept. 656 historical rows, **nothing new since 2026-07-17**. Dead, as claimed.
2. **worker self-reported `stalled`** (`source_kind=worker`, via AGENT_NOTIFY_SUMMARY) — a LIVE,
   legitimate signal (10 rows, newest 3 days ago). Also maps to category STALE.

The earlier "0 live" came from the overseer `query_events` tool (recent hub-inferred rows are
`attention_candidate=0`); the DB retains the history. **F5 correction:** the committed F5 blanket-
obsoleted category=STALE, which would have eaten the live worker self-reports (#2). Fixed to sweep
**FINALE only** (commit `72aaab1ba`). Caught pre-soup by this P0.5 pass — the case for running the
read-only analysis before building the actuator.

## Open questions (for overseer prep + operator)

1. Tier names — `notify / propose / ask` OK, or map onto the existing permission-mode vocabulary?
2. Does `notify`-tier auto-handling ship in Phase 3, or does the operator want a longer
   suggest-only soak first? (Friction vote: longer soak — earn the leash.)
3. Where do standing orders live — a new table, or reuse a policy field on the operator's namespace?
4. Undo horizon for auto-handled items — how long is "one-step undo" available?
5. Delegation clarifying-question relay — synchronous wait vs async notify-back to the operator?

---

## Overseer-prep review — red-lines (2026-07-31, converse/entity owner)

Shape accepted. The frozen design above stands; the notes below are precision + sequencing for the
bricks I own. Agreements first so the red isn't the whole picture:

**Agreed / keep as-is:** keystone-first; human-ON-the-loop (not in-it); causality > rank for
interrupts; tombstone-as-summarizer (no separate summarize-engine); discovery suggests-never-enacts;
the brain never authors policy or invents a tier. P0.5 is cheap — **recommend NOT skipping it**: it
also mints the operator's first *hand-authored* buckets before the discovery engine exists, so P1/P3
have seed standing orders without waiting for P2 data.

**R1 — Pin the keystone WRITE trigger before P1 (the crux).** "Manual disposition write-path"
underspecifies the *trigger surface*. To honor "the write IS the tombstone trigger — no fuzzy 'did we
decide?' classifier," the write must be an explicit **act**, not a retro-scan of the transcript. Two
clean surfaces, ship **both**:
  - (a) **UI affordance** — tap resolve/snooze/dismiss on the item card. Unambiguous, zero brain
    judgment, works with the brain offline. This is the truth-path.
  - (b) **`record_disposition` write-tool** the brain calls **only on an explicit operator
    imperative** ("resolve that", "snooze jellyfin 3 days") — the voice/hands-free path.
  Caveat to the spec's wording: (b) still contains a lightweight *intent boundary* ("is this an
  imperative?"). That's acceptable because the failure mode is reversible (undo) — but the "no
  classifier at all" claim is slightly too strong. The win isn't "zero intent detection," it's "an
  explicit act at a well-defined boundary instead of a retro-scan." Both surfaces write the same row.

**R2 — This breaches the Stage-0 read-only invariant; name the transition.** The disposition write is
the Overseer's **first state mutation beyond `convo_turn` memory**. Today `buildOverseerIdentity()`
sets `canDispatch: false` and the system prompt hard-says "You CANNOT … change any state." That line
must be revised **surgically**: the Overseer may now *record dispositions* (and later *relay*), but
still cannot spawn / dispatch / mutate worker state. Recommend a **granular capability enum**
(`canDisposition`, `canRelay`) rather than flipping `canDispatch`, so the leash stays fine-grained.
Call this Stage 0 → Stage 1 explicitly in the identity + prompt.

**R3 — The tombstone needs a READER; H3 is coupled to P1, not deferrable.** The tombstone's
cross-turn value (collapse prior context on turn N+1) requires later turns to *see* prior
dispositions. Converse is stateless per request (`messages` in each call), so either the transport
substitutes the one-liner into resent history **or** the brain re-queries — both need a lean
`query_dispositions` reader. So H3 ("deferred, ~0 volume") is actually a **P1 dependency** the moment
tombstones must render. Minimum viable: the write-tool returns the tombstone string for same-turn
render, and the lean reader ships in the same brick.

**R4 — Reversibility × blast-radius are AUTHORING-time inputs, not runtime.** The tier table's "Gate"
column conflates them. At **match** time the brain must not weigh reversibility/blast-radius — that's
judgment. Runtime = *predicate match → operator-assigned tier → canned action; else ask.* The two
axes are guidance the **operator** uses when authoring a bucket's tier (they already encoded "this is
reversible + low-blast" by picking `notify`). Restate so the brain's runtime job is purely mechanical.

**R5 — Delegation is the sharpest edge: not cleanly reversible, and don't shell `ping-peer` from the
hub.** A relay can't be un-sent; "one-step undo" is weaker here (a retract follow-up, not a rollback).
Default relays to `propose`/`ask`; **`notify`-tier auto-relay should be excluded or gated hardest** —
it is the one place auto-fire mails an irreversible instruction to another agent. Also: reuse the
*capability*, not the script — the hub already has the internal primitive (`POST /sessions/:id/messages`
+ resume in `hub/src/web/routes/sessions.ts`); call it directly. `hapi-ping-peer` is the operator/agent
CLI wrapper; the hub shelling out to it would be a layering inversion.

**R6 — poll-on-turn needs a causal-set CARRIER (doesn't exist today).** "Sessions this conversation
dispatched to / the in-focus item" is not tracked — converse is stateless. Define the carrier:
`causal set = sessionIds from dispositions/relays recorded in THIS conversation + an explicit
focusSessionId on the converse request`. Without it the interrupt tier is uncomputable. Cost note: the
interrupt-tier adds a tiny `query_events{sessionId, sinceTs}` per turn — gate it to fire **only when
the causal set is non-empty**, else every turn pays for a poll.

**R7 — Causal-gating can mute a true P0.** Silencing even high-priority ambient events is the right
default, but it can starve a genuine emergency from a *non-dispatched* session (prod-down failure the
operator never dispatched). Add a narrow, **operator-authored** `interrupt` escape hatch (a standing
order flag: e.g. `severity ≥ 5 + bucket → always interrupt`) so causality-gating stays human-on-the-loop
instead of silently rank-blind. → new open question.

**R8 — Freeze the bucket features ON the disposition row (write-time snapshot).** Record a
denormalized `{sourceKind, eventType, category, repo, provenance}` snapshot on the disposition at
write time. Events can be re-scored later; discovery must cluster on **what the operator saw**. Cheap,
and it makes P2 discovery a `GROUP BY` instead of a re-derivation. Write-path is mine; the column is a
shared/ingest touchpoint — do it in P1 so P2 is trivial.

### Open-question votes
1. **Tier names:** keep `notify / propose / ask`. They describe the *operator experience*; the
   `modes.ts` permission vocab (`acceptEdits / bypassPermissions`) gates *per-tool-call* and would
   overload the terms. Document the analogy; don't merge the vocabularies.
2. **notify-tier phase:** longer suggest-only soak — agree with the friction vote. Auto-fire only
   *after* P2 proves buckets; never in the same brick as discovery.
3. **Standing-order storage:** a dedicated, **additive** `standing_orders` table (idempotent DDL, no
   `SCHEMA_VERSION` step — same pattern as `ensureOverseerEventsSchema`), not a JSON blob on the
   namespace. Predicates are matched per event → they must be indexable; and a table gives audit
   (created_ts, hand-authored vs discovery-suggested, enabled flag).
4. **Undo horizon:** record-actions (resolve/snooze/dismiss) are reversible **indefinitely** — it's a
   row flip. Relays get a **short retract window** (conversation-scoped or N minutes) then become
   audit-only. Two different undo semantics; don't promise "rollback" for the irreversible one.
5. **Clarifying relay:** **async** notify-back. A synchronous wait blocks the secretary and destroys
   the constant-context-cost property that justifies the whole delegation model. The agent answers
   whenever; the answer arrives as an ambient/interrupt event.

### Ingest touchpoints I need sequenced (ping back)
- **Disposition schema:** I write the row incl. the R8 feature snapshot; you consume it for
  scoring/learning + the discovery watcher. Agree the column set before I cut the write-path.
- **`query_dispositions` reader:** I'll own the lean reader (converse needs it for tombstones per R3).
  Confirm the discovery watcher doesn't need a different shape, or we share one.
- **Causal poll filter:** I own the converse-side causal-set carrier (R6); you own the
  provenance/`relatedEventId` chain query over events. Boundary: I hand you `{sessionIds, sinceTs}`,
  you return meaningful-transition events (completed/blocked/needs_decision, not progress).
- **P0.5 output:** when you run retrospective bucket analysis, hand me the top candidate buckets —
  they become the operator's first hand-authored standing orders in P1/P3 (pre-discovery bootstrap).
