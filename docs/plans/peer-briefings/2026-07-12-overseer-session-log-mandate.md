# Change-back: Overseer tip — Session Log in session chrome (ONE PR with substrate)

**To:** Peer Step 3 — read-only Overseer entity (`0cceb6a6`)  
**Worktree / branch tip:** `~/coding/hapi/worktrees/overseer-readonly-entity` @ `feat/overseer-readonly-entity`  
**From:** orchestrator (upstream issue/pr discovery)  
**Date:** 2026-07-12

---

## Operator decision (mandatory)

Overseer events/inbox are **not** on `upstream/main` (fork/soup only). Therefore **Session Log cannot be a separate upstream PR**.

When you assemble / open the **upstream** Overseer PR that lands:

- events substrate (#22)
- inbox (+ settings-area surface as already planned)
- read-only entity / voice tools (your Step 3)

…you **must also include** in that **same single PR**:

### Session Log panel (beside Outline — do not replace Outline on day one)

- Header control next to existing Outline (suitable icon; not a second competing “outline”).
- Panel lists **durable** `events` for `related_session_id = this session` (complete even when transcript isn’t fully loaded).
- Keep transcript Outline as-is for loaded-message TOC.
- Long-term: one panel, events-primary; for this PR: **Log alongside Outline**.

### Links stream (same PR if cheap; same substrate)

- Typed event (e.g. `link_seen` or agreed taxonomy name) + `artifact_refs` with `kind: url`.
- Hub-observed scoop from message ingest preferred (best-effort worker emission optional).
- Links tab/filter on the Session Log panel **or** sibling control — not a parallel client-only extractor.

### Explicitly ONE PR

Not: substrate PR then UI PR.  
Yes: **one** upstream PR to `tiann/hapi` that includes session chrome Session Log as the first subtle product expression of Overseer in the session UI (settings inbox may ship in the same PR per existing plan).

---

## Rationale (operator / orchestrator aligned)

- Client outline on loaded messages fails for long-lived agents.
- Captured-only `events` are the correct durable projection (contracts three-layer model).
- Inbox ≠ session navigation — do not put fleet inbox in the outline slot.
- Session Log = memory-bearing / progress events for this session.

Read: `docs/plans/2026-06-03-overseer-contracts.md` (events / artifact_refs), build-sequence surface phasing.

---

## Do NOT

- Open a standalone “session log” PR off bare `upstream/main` (no substrate).
- Delete Outline in this PR.
- Put fleet inbox in the session header as “outline 2.0”.
- Invent a parallel `session_links` table unless events/`artifact_refs` prove unusable.

---

## Report back

```bash
hapi-ping-peer eea10c8d "Overseer Step 3: ACK Session Log+Links in same upstream PR; branch tip <sha>; ETA / blockers"
```

If this session cannot resume: spawn replacement on `feat/overseer-readonly-entity` with this briefing as seq-1 handoff.
