# Peer brief — ContributionState channel ingest (slice A)

> **Spawned:** 2026-07-25  
> **Role:** soup-first hub ingest for ContributionState  
> **Worktree:** `~/coding/hapi/worktrees/contrib-state-ingest`  
> **Branch:** `feat/contrib-state-channel-ingest` (stacked on `feat/overseer-readonly-entity`)  
> **Canon spec:** [`docs/plans/2026-07-25-contrib-state-event-ingest-spec.md`](../2026-07-25-contrib-state-event-ingest-spec.md) §3 (hub) — read the whole file  
> **Principle:** [`docs/plans/2026-07-25-contribution-state-as-overseer-sensor.md`](../2026-07-25-contribution-state-as-overseer-sensor.md)

## Goal

Add `POST /api/system-events` that accepts **only** `sourceKind: 'channel'` events, validates body, binds optional `relatedSessionId`, and calls existing `insertSystemEvent` (server-side idempotency dedupe already works).

This is the estate's first external/channel event producer path. meta-daily `--emit-events` (slice B) is **out of scope for you** — Meta owns that after you land A.

## Constraints

- **Soup-first.** Dogfood on `:3006` via soup layer when ready. Do **not** open an upstream `tiann/hapi` PR for this.
- Do **not** hand-edit `~/coding/hapi/driver`.
- Do **not** invent `sourceKind: 'external'` — enum value is `'channel'`.
- Do **not** mutate session titles/metadata from this route (actuation stays in meta-daily).
- Do **not** mark GitHub notifications read.
- ADR-001: channel events must **not** leak into worker-facing transcripts as system messages.
- Prefer extending `hub/src/web/routes/systemEvents.ts` (GET already exists).

## Acceptance (from spec §7 Hub)

1. `POST` with `sourceKind: 'worker'` → 400  
2. Valid channel event → 201; visible on GET  
3. Same `idempotencyKey` → 200 `{deduped:true}`, one DB row  
4. Unknown `relatedSessionId` → 404; omit → 201 with null  
5. Wrong-namespace session → 403  

## Demo topology

**Soup** after operator approves. Until then: peer-stack or unit tests against Store in-memory. No stack-switch from agent shell.

## Report back

Typecheck + tests green; route diff; how to POST a sample event with JWT; any schema gaps vs spec. Do **not** enable meta-daily emit yourself.
