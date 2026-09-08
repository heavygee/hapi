# Overseer — autonomy axes, operator surface, and the modality question

> **Status:** DESIGN DIALOGUE, 2026-08-31. Not blessed, not scheduled, nothing authorized to build.
> **Scope:** fork-only. Never enters an upstream PR diff (`docs/plans/` is leak-scanner enforced).
> **Origin:** operator asked for a press-and-hold-to-talk conversational surface into the Overseer
> (handoff `docs/handoffs/2026-08-29-overseer-press-to-talk-surface.md`), then answered the three
> design forks put to them with a **two-axis autonomy model**, a **UI home**, and a **confirm
> affordance**. They explicitly asked for the axes to be disputed and for the existing Overseer
> documentation to be reconciled with them.
> **Companions (all pre-existing, none superseded by this doc):**
> - `2026-06-03-overseer-framing.md` — concept, one-boss, voice-above-workers (Rev 4, frozen)
> - `2026-06-03-overseer-contracts.md` — schemas + **the Stage 0–3 autonomy ladder** (§ Autonomy gates)
> - `2026-06-03-overseer-build-sequence.md` — MVP bar, non-goals
> - `2026-07-31-overseer-action-architecture-standing-orders.md` — **the notify/propose/ask tiers**, R-invariants
> - `2026-08-14-overseer-general-agent-tooling-gaps.md` — what a general agent can reach today
> - `2026-05-24-xr-multi-agent-workstation-vision.md` — Emit/Receive/Identify/Position/Attract surfaces
> - `docs/adr/0001-worker-facing-attribution-one-boss.md`
> - `docs/operator/overseer-standin-activity-log.md` — the empirical error record (load-bearing in §3.4)

---

## 0. Ground truth, verified 2026-08-31

Stated up front because two of the challenges below depend on it, and because the first pass of
this dialogue got one of these facts wrong.

| Claim | Verified how | State |
|---|---|---|
| Overseer backend is live and answering | `hapi-overseer-call.sh converse` → correct answer in ~2s, tool trace shows a real `query_inbox` | **live** |
| Brain is a frontier model, not the flaky local 27B | `GET /api/overseer/brains` → `active: {profile: "openai", model: "gpt-4o"}` | **live** |
| 11 tools, writes gated to the converse path only | `GET /api/overseer/identity` | **live** |
| Overseer **cannot spawn** | identity: `canDispatch: false`; system prompt: *"You still CANNOT spawn new workers, invent work…"* | **by design** |
| `ping_session` is one-way | tool description: *"Irreversible once delivered — never invent a ping."* | **by design** |
| There is an Overseer **admin console** in the UI, behind the eye icon next to the gear | `web/src/routes/overseer/index.tsx` → `OverseerBrainPanel` + identity/tools list + chat/events/inbox debug panels | **soup only** |
| That console is **not on `main`** | `git log --all` — lives on `feat/overseer-admin-console` and descendants; `main`'s `web/src` has zero `/api/overseer` references | **unlanded** |
| A text converse UI already exists | `web/src/components/settings/OverseerChatDebugControls.tsx` | **soup, self-described as debug** |

The last row matters. That file's own header comment says:

> *"Debug-only text transport for the modality-agnostic Overseer converse core. This is deliberately
> a Settings/debug affordance, **not a top-level surface**: voice/XR are the intended first-class
> modalities and reuse the same `/api/overseer/converse` endpoint. Text is here only to exercise
> the loop."*

So the eye icon the operator pointed at already exists, already routes somewhere, and that
somewhere is a **developer console that deliberately declined to be the operator surface**. The
question is not "where does the Overseer live" — it is "does the console become the surface, or do
they stay two things."

---

## 1. The operator's model (as given, 2026-08-31)

Two axes, each 0–3, described as *"the functional underpinning, devoid of interaction mode"*, and
explicitly flagged as *"100% a 'here be dragons' notion, the upper bounds of which make people
REEEEEALLLY uncomfortable… if these were slider UI controls, the upper bound would be red."*

### Axis A — "Knowledge and Attention / proaction"

| # | Behaviour |
|---|---|
| 0 | Gathers intel and awareness of what it *should* know, in the background. Says nothing. |
| 1 | Populates certain items for your attention, based on what it learned at 0. |
| 2 | Actively gets your attention, proactively, based on agent activity. |
| 3 | Autonomously takes action based on understanding of the underlying intent, including supplying **actual irreversible responses** to agents in need. |

### Axis B — "responsive" (what it may be instructed to do)

| # | Behaviour |
|---|---|
| 0 | Queried about things the operator knows/suspects exist in the estate — findable things with state. Returns context and status. |
| 1 | Queried **and instructed** about work already in progress — existing sessions the operator knows are there; go find them and give instruction/additions. |
| 2 | Instructed to take on **new work in an existing locale** — a project that exists, has a working directory, has had prior agents (live, archived, or deleted). Spawn a new session there. |
| 3 | Instructed to take on an **entirely new project** — no working directory, no prior agentic work anywhere in the estate. The nature of the work is a conversation with the Overseer, who then makes it happen. |

---

## 2. What's genuinely new here

Stated before the challenges, because the challenges are narrow and this is not.

**Axis B does not exist anywhere in the Rev 4 architecture.** The frozen contracts describe Stage 0
as *"Cannot: dispatch, spawn, modify state"* — one undifferentiated bundle. Every existing
autonomy vocabulary in this estate (Stage 0–3, `notify/propose/ask`) is about **initiative**: how
far the Overseer goes *without being asked*. Nothing has ever described the **capability ceiling
when it IS asked**. That is a real gap and Axis B fills it.

The separation matters concretely: today's Overseer sits at roughly **A1–A2 / B1** — it populates an
inbox, a systemd watch-loop pages on ERROR/BLOCKED, and `ping_session` reaches into existing
sessions. There is no vocabulary in which to say "I want B2 but never A3," and that is exactly the
sentence the operator needs to be able to say.

---

## 3. Challenges (the dispute the operator asked for)

### 3.1 The scary end of Axis B is not the dangerous end

Axis B is ordered by **novelty** — how unprecedented the work is. Risk is ordered by **blast
radius × reversibility**, which is the gating pair the standing-orders doc already settled on. At
the top of the axis those two orderings come apart, and arguably invert:

- **B3** — spawn a fresh agent in a directory that did not exist, on work never attempted. Worst
  realistic case: wasted tokens and a junk directory. This is a **two-way door**. It *sounds*
  terrifying ("the AI starts its own projects") and is close to the most sandboxed thing on the list.
- **B1** — inject an instruction into a live agent that is mid-merge on a production repo. Worst
  realistic case: a force-push over `main`, a deploy, an email sent, an irreversible API call
  performed by a competent agent that believed the operator asked for it. This is a **one-way
  door with unbounded blast radius**, and it is *already shipped* (`ping_session`, live today).

So the red zone on the slider does not start at B3. It starts at **B1**, and B1 is where we are
standing. If the UI paints B3 red and B1 amber, the UI is lying about the risk in a way that will
make the operator careless at exactly the wrong notch.

**This is observed, not hypothetical.** Reported by the Overseer stand-in (session
`a6a47b14`, 2026-08-31) when this inversion was put to it:

> *"I have been operating at B1 all week, with no confirm card and no gate. Via
> `ping_peer`/`ping_session` I have instructed live agents to push branches, force-push a rebase,
> close a PR, restore deleted files, and change an org-wide PAT policy. **Several of those
> instructions were wrong when I sent them.** The PAT one was refused by the receiving agent on the
> grounds that it could not verify me — correctly."*

So the one-way, unbounded-blast-radius rung of Reach is already shipped, already ungated, and has
already been exercised in error. The only thing that stopped the worst instance was a *worker*
declining an instruction it could not authenticate — which is a happy accident of the a2a identity
work, not a control this design put there.

**Proposed fix:** keep the axis (the novelty ordering is a genuinely useful way to reason about
*capability*), but colour it by blast radius, not by ordinal. Or: keep B for capability and put the
danger signalling on a **third axis** (§3.5).

### 3.2 A3 is Stage 3, which the operator previously ruled out — in almost the same words

`2026-06-03-overseer-contracts.md` § Autonomy gates already defines a four-rung initiative ladder,
and its top rung reads:

> **Stage 3 (out of scope for first build) — Open-loop heartbeat autonomy.** Overseer wakes on a
> timer, takes actions the operator hasn't pre-authorised. **The operator explicitly flagged this as
> a bridge too far — AGI-adjacent intent-alignment requirement.** Mentioned for completeness; not on
> the roadmap.

A3 as stated — *"autonomously taking action based on understanding of the underlying intent"* — is
that rung, and the phrase "understanding of the underlying intent" is the same intent-alignment
requirement, restated as a feature. Three months on, from a different direction, the same door is
being re-opened.

This is **not** an argument that it must stay shut. It is an argument that re-opening it should be
a deliberate, recorded reversal with a stated reason, not something that arrives as notch 3 of a
slider that also contains "show me a notification."

### 3.3 A3-by-inference collides head-on with a written safety invariant

`2026-07-31-overseer-action-architecture-standing-orders.md`, § Safety invariants (non-negotiable):

> - The brain **never authors policy or invents an autonomy tier**. Match-and-execute only; novel /
>   ambiguous → `ask`.
> - `notify`-tier auto-handling requires an **operator-authored** standing order **AND** a
>   reversible action **AND** low blast radius.
> - Discovery **suggests**, never **enacts**.

"Autonomous action based on understanding of the underlying intent" is precisely *inventing the
tier*. There are two readable versions of A3 and they are not close:

- **A3-policy** — the Overseer executes decisions the operator *already made*, encoded as
  standing orders with bucket predicates. Fully compatible with the existing spec. Already
  designed. Mostly unbuilt.
- **A3-inference** — the Overseer infers what the operator would have wanted and acts. A
  repudiation of the invariant above, and the thing the contracts doc called a bridge too far.

The doc cannot hold both. **This is the single decision that shapes everything downstream.**

### 3.4 The empirical case against A3-inference is in this repo

`docs/operator/overseer-standin-activity-log.md` is the record of a frontier model with full tool
access standing in for this exact role. Its own 2026-08-27 entry:

> *"Tally for the day, stated plainly: **five assertions made before isolation** — the #104
> citation, [the "no PR" claim, the deleted-session call, …] the capability re-mint fix. **Each was
> plausible, checkable, and wrong.** The corrective that actually works is the one this log keeps
> re-deriving: enumerate the artefact before asserting it."*

When this was put back to the stand-in, it corrected the count upward and offered a sharper
instance — the one that actually demonstrates the mechanism this axis governs:

> *"It was five when I wrote it; it is now at least eight, and the shape matters more than the
> count. The instance you should actually cite is this one: **my false negative became another
> agent's instruction.** I told the runner-audit session three `.env` files had no hook. They were
> `root:jessica-builder 0640` — unreadable, not empty. Acting on my false premise, it edited two
> configs it believed were blank and **nearly clobbered an existing Podman cleanup hook.** It caught
> itself pre-restart. Nothing broke, but the failure path was: my unverified claim → another
> agent's confident action → someone else's infrastructure."*

That is the whole argument in one incident. The error did not stay with the agent that made it — it
**propagated through the dispatch channel** into a competent worker that had no way to tell a
confident false premise from a true one, and was stopped by luck and the worker's own second
thoughts. Initiative-3-by-inference is a proposal to remove the operator from precisely that path.

It also names a specific failure shape worth designing against: the stand-in reports this as the
**fourth instance** of one recurring error — *"I keep reporting 'my query returned nothing' as 'the
thing is not there'"* (an empty `gh pr list --search` → "no PR was ever opened", when #19 existed; a
0-result `gh search code` → "no repo uses gitleaks-action", when six do; a permission-denied
`grep -q` → "no hook configured"). §0 of this doc exists because that same shape produced the
inventory error in the originating handoff. **A false negative is the hardest error for a reviewing
human to catch, because there is nothing on screen to disbelieve.**

Five confident, plausible, wrong inferences **in one day**, by the best available model, on
questions where the ground truth was one tool call away. A3-inference proposes handing that same
process an irreversible write path with no human in the loop. A3-policy hands it a lookup table the
operator authored. The base rate is not an abstraction here — it is logged, dated, and self-reported.

### 3.5 A third axis is missing: **scope**

The estate in the screenshot is **703 sessions across 105 projects**, spanning multiple machines.
"B2: spawn a new session in an existing locale" is, unqualified, *any* of 105 locales. A capability
ceiling without a scope ceiling is not a leash.

The missing control is **where** the Overseer may act — a project / repo / machine allowlist. Prior
art is already in the estate: standing-order **bucket predicates** are defined over
`sourceKind`, `eventType`, `category`, repo/artifact, provenance. The same predicate language is the
scope language. A slider at B2 restricted to `project ∈ {hapi, hapi-inline}` is a completely
different proposition from B2 unrestricted, and only one of them is shippable.

### 3.6 Sliders imply global monotone trust; trust here is per-bucket

A global two-slider settings control says "I trust the Overseer this much, everywhere." That is
never true. The operator trusts it to dismiss a Dependabot notification unattended and does not
trust it to nudge a session that is mid-release, and the difference is not a global number.

**This is a reframe, not a rejection.** The sliders are excellent — as **ceilings**, not modes:

> The A/B sliders set the **maximum tier any bucket may reach**. The actual decision for any given
> bucket is still an operator-authored standing order at `notify` / `propose` / `ask`. Turning a
> slider up does not change any behaviour by itself — it enlarges the space of policies the
> operator is *allowed to author*.

That composes with every safety invariant already written instead of overriding them, it makes the
red zone honest (raising the ceiling is genuinely dangerous *because of what it permits*, not
because of what it does), and it preserves the "discovery suggests, never enacts" promotion path as
the only way behaviour actually changes.

### 3.7 The two axes are not independent

A3 (act unbidden) is meaningless without B ≥ 1 — act on *what*? The invariant to state explicitly:

> **A is bounded by B.** The Overseer may never do unbidden anything it could not be instructed to
> do. Preferably strictly: the unbidden set should be a proper subset of the on-request set.

Conversely A0/B3 is perfectly coherent and possibly the sweet spot: *completely silent unless
spoken to, but fully capable when it is*. Worth naming as a preset.

### 3.8 A tension between two existing docs that this work will hit

`2026-06-03-overseer-contracts.md`: *"the naive 'write-with-rollback' framing was rejected —
**rollback is fantasy once work has been done**. The actual safety mechanism is **gate-before-action**,
not undo-after-action."*

`2026-07-31-overseer-action-architecture-standing-orders.md`: *"Everything auto-handled leaves a
**tombstone + one-step undo** + audit trail."*

These are not flatly contradictory (the second scopes undo to reversible low-blast-radius actions),
but any A3 design will lean on one of them, and the operator's confirm-card answer (§4.3) is a
gate-before-action mechanism. Worth resolving in words before it is resolved in code.

---

## 4. The operator surface (operator's answer 2 and 3, plus consequences)

### 4.1 Home

- Lives at the **eye icon next to the settings gear**. That icon and route already exist in soup
  (`/overseer`), currently pointing at the admin console.
- **Overlay/float by default**, because the layout is responsive and mobile has no fixed real
  estate to donate. Docked when there is room.
- **Badge + pulse** on the eye when the Overseer has queued items: a red counter, mirroring the
  existing session-row unread-dot language (`SessionAttentionIndicator`).
- Clicking replaces the **session area**, not the sidebar — a peer of the session view, not a panel
  inside it. This is the framing doc's "chrome-button insight" cashed out.

**Consequence to decide:** the admin console currently owns that route and that icon. Either the
console moves (to Settings, where its debug panels arguably belong) and the surface takes the eye,
or the surface becomes a tab within the console. Two things cannot own one icon.

The distinction is **audience, not feature set** (stand-in, 2026-08-31): the existing console is a
*debug/admin* surface — brain selection, tool inventory, converse debug — aimed at whoever is
building the Overseer. What the operator described is an *operator* surface, aimed at someone
managing attention across a fleet and not thinking about brain profiles at all. Whether that is one
thing with modes or two things with separate homes is a genuine design question, not a merge
conflict to paper over.

### 4.2 What makes it not-a-session

The operator's framing, which is the sharpest line in this whole dialogue:

> *"the business of it, is other agents' business, whereas those agents' business is the things
> that they are building."*

Text is text and a conversation looks like a conversation, so the *transcript* may render like a
session. The difference is in the **affordances**, which are all references to other agents:

- **Peer name chips** — inline references to sessions, already an estate primitive.
- **Agent cards** — richer than a chip: state, age, context weight, progress; *"everything you see
  in the left-hand session area for an agent, and more."*
- **The inbox as a felt thing** — a queue the Overseer wants to whittle down. *"An empty inbox makes
  the Overseer happy, a full one makes them anxious."* Persona is already a load-bearing workstream
  in the framing doc; this is that, made visible.
- Every conversational outcome **lands on another agent**. That is the invariant that distinguishes
  this surface from a chat window.

Note the direct line to `2026-05-24-xr-multi-agent-workstation-vision.md`: its surface
decomposition — **Emit / Receive / Identify / Position / Attract** — is exactly what an "agent card"
is in 2D. Identify + Emit + Attract, flat. Designing the card against that vocabulary makes the XR
mode a re-rendering rather than a rebuild, which is the operator's *"many ways, one concept"* stated
plainly.

**Open:** what powers it — an agent session, or the local/remote brain via `/overseer/converse`.
Currently unresolved and deliberately so. The converse loop is modality-agnostic and already
frontier-backed (§0), so this is a swappable decision, not a foundational one.

### 4.3 The confirm affordance

The operator's answer, which is well-formed and needs almost no argument:

> *"It's a button or a spoken 'ok' — but in response to what? A visual 'here's what I'm going to
> say', a summarized version, like the summaries/actions all agents create, with an option for the
> operator to have more explanation if they wish, up to and including seeing the entire text that
> the agent WOULD receive."*

Three properties worth pinning:

1. **One card, three timings.** The same intent card appears at every tier — *before* the action at
   `ask`, as a *one-tap* at `propose`, and *after the fact as a tombstone with undo* at `notify`.
   Turning the dial up must not change what a confirmation *looks like*; it changes how many the
   operator sees and when. Consistency here is what keeps the dial legible.
2. **Progressive disclosure down to the literal payload.** Summary → explanation → the exact text
   the worker will receive. That last level is not a debug feature; it is the only thing that makes
   the one-boss rendering auditable by the person whose name is on it (ADR-001).
3. **It reuses an existing shape.** The dispatch envelope (contracts §13) already carries the
   rendered instruction, provenance, and confirmation source. The card is a view of the envelope,
   not a new object.

### 4.4 Modality caps the ceiling (new constraint, falls out of the above)

The confirm card is *visual*. The originating use case — press-and-hold, talk, possibly a phone in a
shower with no screen in play — has no way to render it. Spoken readback can carry a **summary** and
take a spoken "ok", but it cannot carry "show me the entire text the agent would receive."

Therefore:

> **The A/B ceiling is per-modality, not global.** A modality that cannot render the full payload
> cannot authorize an action whose payload the operator would want to read. Voice-without-screen
> should sit at a lower ceiling than voice-with-screen, which sits at the same ceiling as text.

This is not a retreat from *"many ways, one concept."* It is the same concept, with the honest
observation that **the ways differ in what they can prove to the operator before acting**. It also
imposes a real design constraint upward: the summary must be short enough to *speak*, which is a
much tighter budget than short enough to read.

### 4.5 Gesture collision with #1594

#1594 is landing hold-to-talk on the **session search box** = dictate into search. Search is also a
"find me the thing" surface. If long-press elsewhere means "talk to the Overseer", the same gesture
means two things depending on the pixel. Options:

- **One surface with escalation** — voice into search finds the thing; adding an imperative
  ("…and tell them X") escalates the same utterance to the Overseer. Coherent, and matches how the
  operator actually described the ask.
- **Two gestures** — search keeps long-press; the Overseer gets its own (the eye button itself,
  press-and-hold).

Decide before both ship, not after.

### 4.6 Press location as a deictic anchor

The originating handoff treated "does the press location carry meaning" as a central question. It
is not central. The Overseer's whole job is finding things across the fleet and it demonstrably
can. The anchor is a **pronoun resolver**, not a context mechanism — "ping *this* one about the CI
thing" needs one field on the utterance (`anchor: {kind, id}`), not an architecture. Worth having,
cheap, not a fork in the road.

---

## 5. Proposed reconciliation of vocabularies

Three vocabularies now describe one concept. Three is how a spec rots. Proposal:

| Concept | Keep | Retire / re-express |
|---|---|---|
| **Initiative** — how far it goes unbidden | Operator's **Axis A**, renamed **Initiative** (0 silent / 1 organises / 2 interrupts / 3 acts) | Fold Stage 0–3 in as the same ladder; keep the contracts doc's Stage 3 warning attached to A3 |
| **Reach** — capability ceiling when asked | Operator's **Axis B**, renamed **Reach** (0 read / 1 instruct-existing / 2 spawn-in-existing / 3 new-project) | Genuinely new; nothing to retire |
| **Scope** — where it may act | **New third axis** (§3.5): project / repo / machine predicate | Reuses standing-order bucket-predicate language |
| **Per-bucket decision** | `notify` / `propose` / `ask` unchanged | Not replaced by the sliders — the sliders are its **ceiling** (§3.6) |

Invariants to carry forward: **A ≤ B** (§3.7); the brain matches policy and never authors it
(§3.3); one-boss attribution regardless of tier (ADR-001).

---

## 6. Open questions

1. **A3-policy or A3-inference?** (§3.3) The load-bearing decision. Everything else composes around it.
2. **Do the sliders act, or permit?** (§3.6) Modes or ceilings.
3. **Who owns the eye icon** — admin console or operator surface? (§4.1)
4. **What powers the surface** — an agent session or the converse brain? (§4.2)
5. **Does the third (Scope) axis exist**, or is scope folded into per-bucket standing orders only? (§3.5)
6. **One gesture with escalation, or two gestures?** (§4.5)
7. **Does re-opening Stage 3 get recorded as a deliberate reversal?** (§3.2) If yes, it likely wants an
   ADR rather than a plan doc, since ADR-001 set the precedent for decisions of this weight.

## 7. What this doc does not do

- Does not authorize any implementation. No issue, no branch, no PR.
- Does not lift the Rev 4 freeze on the framing/contracts/prioritization/build-sequence set.
- Does not resolve §6. It records the dispute; the operator resolves it.
- Anything that graduates from here goes through `docs/tooling/new-feature-intake.md` — issue first.
