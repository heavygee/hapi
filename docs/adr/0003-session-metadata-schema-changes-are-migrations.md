# ADR-003: A session MetadataSchema change is a data migration, not a code change

> **Status:** accepted — operator directive, 2026-11-24
> **Date:** 2026-11-24
> **Deciders:** operator, with meta HAPI triage (`5225a255`) as the investigating counterparty
> **Scope:** fork-local process rule. The *tool* is fork-only. The *product defect* it compensates for
> is generic HAPI and is upstream-shaped — see § Upstream.
> **Instrument:** `scripts/tooling/hapi-session-metadata-audit.sh` (+ `.test.sh`, 10 assertions, every
> check driven red)
> **Companion:** `docs/plans/2026-11-08-meta-swap-retitle-audit-race.md` § the method lesson

---

## Context

`MetadataSchema` fails **wholesale**. If any single optional sub-object no longer parses, the hub
discards the session's *entire* metadata — `path`, `flavor`, `machineId`, `lifecycleState`, all of it.
The row stays intact on disk. The hub serves `metadata: null`, `POST /sessions/:id/resume` answers
`Session metadata missing path`, and the session is **permanently unrestartable**.

It fails silently. Nothing alerts. The session simply stops being resumable, and nobody finds out
until someone tries to open it — which may be weeks later.

This happened **twice**, and both times the trigger was the same shape: **a required field added
inside an optional object**, retroactively invalidating rows written before that field existed.

| Trigger | Introduced | Data written | Sessions killed |
|---|---|---|---|
| `externalRefs` — "at most one primary GitHub PR" superRefine (#1163) | 2026-11-18 | 2026-10-10, 2026-10-26 | 2 |
| `lastModelError.eventId` became a required string | 2026-11-13, firmed 2026-11-22 | months earlier | 96 |

98 sessions in total, discovered only because the operator tried to restart one of them.

The codebase already knows this hazard. The comment beside `claudeRewind` in `shared/src/schemas.ts`
says a malformed value there parses "as undefined instead of failing MetadataSchema: the hub would
otherwise drop the whole session metadata (flavor, machine, path, lifecycle)." That defence was
applied to exactly one field. Nothing generalised it.

## Decision

**Any change to session `MetadataSchema` is a data migration and must be treated as one.**

Specifically, when adding a required field, tightening an enum, adding a `superRefine`, or narrowing
any existing type:

1. **Run the audit before and after** — `hapi-session-metadata-audit.sh`. It validates every stored
   row against the schema of the build the hub is *actually running*.
2. **If rows go invalid, resolve it in the same change.** Two acceptable resolutions:
   - migrate the rows forward, or
   - make the new constraint lenient so legacy shapes parse as `undefined` rather than failing the
     parent object (the `claudeRewind` precedent).
3. **Never ship the tightening alone.** A schema change that invalidates stored rows and leaves them
   is a silent outage with an unbounded discovery delay.

### Why a tool and not just a rule

A rule nobody can check is a rule nobody keeps. The audit exits non-zero on drift, names the failing
field and the affected session ids, and carries a self-check: it parses a deliberately-bad row and
aborts if the schema *accepts* it. A validator that cannot fail would have reported a clean estate
throughout the 96-session outage.

### Audit against the running build, not a mirror

The audit resolves the schema from `hapi-active`/`driver`, never from the mirror checkout. On
2026-11-24 the two had drifted: the mirror's `ExternalRefSchema` was PR-only while the running driver
carried a discriminated union including `github_issue`. Auditing the mirror invents 108 failures that
do not exist. **The only schema that matters is the one the hub is running.**

## Consequences

- Schema tightenings get slower and safer. That is the trade accepted here.
- The audit is cheap (~1,400 rows in seconds) and belongs in the pre-merge checklist for any PR
  touching `shared/src/schemas.ts`, alongside the existing `hapi-*-audit.sh` family.
- It is a **point-in-time** check, not a guard. It cannot prevent a bad write; it detects drift after
  the fact. Pairing it with a periodic timer (as `mergerfs-monitor` does for mounts) would close the
  discovery gap — not done here, deliberately out of scope.

## Upstream

The process rule is ours. The underlying defect is not: **one stale optional sub-field discarding an
entire session's metadata is generic HAPI behaviour**, and any installation that tightens a metadata
schema can silently orphan its own sessions the same way.

The upstream-shaped fix is per-field leniency on `MetadataSchema` — `catch(undefined)` on optional
sub-objects so a legacy shape degrades to "absent" rather than taking `path` and `flavor` down with
it, generalising what `claudeRewind` already does alone.

Not filed. Route through [upstream issue/pr discovery](/sessions/04c8e16c-4cf3-40f2-a76b-944bfc7e7da8)
for confirmation against `upstream/main` before anything is opened — per the confirm-don't-rubber-stamp
pattern that stopped three wrong filings on 2026-11-08.

## Changelog

- 2026-11-24 — Written after 98 sessions were found unrestartable from two separate schema
  tightenings; operator directive: "we need to retain the knowledge that when these kind of metadata
  schemas change, we need to look at a migration of all sessions."
