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

## Open questions (for overseer prep + operator)

1. Tier names — `notify / propose / ask` OK, or map onto the existing permission-mode vocabulary?
2. Does `notify`-tier auto-handling ship in Phase 3, or does the operator want a longer
   suggest-only soak first? (Friction vote: longer soak — earn the leash.)
3. Where do standing orders live — a new table, or reuse a policy field on the operator's namespace?
4. Undo horizon for auto-handled items — how long is "one-step undo" available?
5. Delegation clarifying-question relay — synchronous wait vs async notify-back to the operator?
