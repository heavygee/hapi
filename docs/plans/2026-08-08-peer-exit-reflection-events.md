# Peer exit reflection → Overseer SystemEvent

> **Status:** process SHIPPED 2026-08-08; **emit SHIPPED (fork tooling)** same day — `hapi-emit-exit-reflection` POSTs channel `SystemEvent` on soup (`feat/contrib-state-channel-ingest`). Not upstream `tiann/hapi`. Meta must emit on Gate A' close; markdown alone is not the Overseer record.
> **Companions:** [`feature-work-lifecycle.md` § Exit reflection](../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup), [`2026-07-25-contribution-state-as-overseer-sensor.md`](./2026-07-25-contribution-state-as-overseer-sensor.md), [`2026-07-25-contrib-state-event-ingest-spec.md`](./2026-07-25-contrib-state-event-ingest-spec.md), contracts §1 events.

---

## Why this is a first-class event

ContributionState already emits PR lifecycle (`⚠️` blocked, `🔧` merged-needing-cleanup, `🧹` complete). That answers **"is the PR/estate tidy?"**

Exit reflection answers a different question the Overseer must eventually own:

> **"What did this peer learn that should change how we work next?"**

That is improvement substrate, not babysit status. Burning the session without a typed event leaves only an optional markdown file Meta might skim. Same failure mode as shipping code without tests: the artifact exists, the learning loop doesn't.

Operator framing (2026-08-08): reflections feel like their own event — Overseer should pay attention down the road for continuous improvement.

---

## Event shape (proposed)

Reuse channel ingest (`POST /api/system-events`, `sourceKind: channel`). Do **not** invent a parallel bus.

| Field | Value |
|-------|--------|
| `sourceKind` | `channel` |
| `sourceRef` | `peer-exit-reflection:<sessionId>` |
| `provenance` | `peer-exit-reflection@meta` or `@peer` |
| `eventType` | `completed` when promote=`none` or `skip:`; `needs_decision` when Promote? asks for index/doc/issue |
| `attentionCandidate` | `1` if promote ≠ none/skip; else `0` (captured-only memory) |
| `operatorActionRequired` | `1` iff High-signal / doc / issue promote |
| `summary` | ≤280 chars: `Exit reflection #N: <promote> — <path or skip>` |
| `relatedSessionId` | peer session |
| `artifactRefs` | `[{kind:github_pr, repo, number, …}]` + optional `{kind:doc_path, path:docs/plans/retros/…}` when we extend the schema; until then put path in `summary` / `action` |
| `idempotencyKey` | `exit-reflection:<sessionId>:<prNumber>:<sha256(path-or-skip)>` |
| `dedupeKey` | same family — one event per session×PR reflection |

Link to the markdown file is mandatory in summary when not skip. Overseer later can cluster `needs_decision` promotions ("three peers asked for Meta statusAction soften") without re-reading every transcript.

---

## Emit path (build order)

1. **Process (done):** Meta 🔧 ping + lifecycle require reflection before idle.
2. **Emit helper (done 2026-08-08):** `hapi-emit-exit-reflection` → `POST /api/system-events` (`sourceKind: channel`, `sourceRef: peer-exit-reflection:<sessionId>`, `provenance: peer-exit-reflection@meta`). Install via `install-hapi-local-bin.sh`. Meta **must** run this on Gate A' judgment (applied / none / skip) **before** archive. Dogfood: event `#7217` for `eb94db45` / #1115.
3. **Still open — expand scope:** intentional archives beyond MERGED Gate A' (short ops sessions, crash archives) — prefer `skip:` captured-only events, not inbox spam. Optional later: peer MCP `record_exit_reflection` in the same turn as the file write.
4. **Not required for start:** upstream blessing, new SCHEMA_VERSION, or Overseer inbox consumer — channel rows are queryable corpus for prep.

Kill-criterion: if emit creates inbox spam on every typo `skip:`, ratchet `attentionCandidate=0` for skip/none and only promote rows hit the inbox (matches chatty→trainable corpus policy). Helper already sets attention=0 for skip/none.

---

## Relation to ContributionState `🔧` / `🧹`

| Signal | Meaning |
|--------|---------|
| Chip `🔧` | Estate cleanup owed or archive pending |
| Chip `🧹` | Babysit ended (archive done) |
| Exit-reflection event | Knowledge harvested (or explicitly skipped) |

A session can be 🧹 without a reflection event only if we accept silent knowledge loss — **policy forbids that** except timebox skip, which still emits `completed` + `skip:` in summary.

---

## Falsification

Next 3 merged peers: require retro file or `skip:`. If ≥1 yields a High-signal promote Meta actually applies, keep the ritual. If all three are empty filler, drop attention promotion (keep file-only).
