# Peer brief — Session external_refs + PR chip (stealth upstream, slice S)

> **Spawned:** 2026-07-25  
> **Role:** independently useful upstream-aimed product surface  
> **Worktree:** `~/coding/hapi/worktrees/session-external-refs`  
> **Branch:** `feat/session-external-refs` (off `upstream/main`)  
> **Why:** pave ContributionState / Overseer without saying "Overseer"  
> **Framing:** ancestor session [State indicators based on PR state](/sessions/fc561649-e783-4a56-be5e-3ca7511c1663); ingest spec § sequencing track **S**

## Goal

Ship the **smallest stealth upstream surface**:

1. Structured **session ↔ external contribution link** on session metadata (or thin column) — namespaced identity, not title parsing.
2. **Clickable PR chip** on the session list row ("this session's PR").
3. Optional read API `GET /api/sessions/:id/external-refs` if natural.

Shape (do not use estate-private `upstream`/`fork` words in upstreamable API):

```ts
{
  kind: "github_pr",
  repo: "owner/name",   // canonical owner/name only
  number: 847,
  url: "https://github.com/owner/name/pull/847",
  role: "primary" | "secondary"
}
```

## Why this matters

Operators encode PR state in session titles (`✅PR #847`) because HAPI has nowhere else to put the link. That hack cross-wires identity (bare `#22`). Structured refs stop the hack *and* give a later fork-side channel producer something durable to attach `related_session_id` to — without upstreaming events/inbox/Overseer brand.

## Constraints

- Branch from **`upstream/main` only**. Product code only — no `docs/operator/`, `docs/plans/`, `CLAUDE.md`, `scripts/tooling/` in the PR diff.
- **Never merge on `tiann/hapi`** — prepare PR; @tiann merges.
- Do **not** implement `POST /api/system-events`, emoji titles, or ContributionState CLI (that's soup/Meta).
- Do **not** parse emoji titles as source of truth for the chip.
- File / link an upstream issue before PR if none exists (intake).
- Demo: **peer-stack** default for UI proof; PNG (chip visible on list) mandatory.

## Non-goals

- Dual-target `control: ours|theirs` in upstream API (fork can infer later).
- Auto-poll GitHub / live PR state badges (v2).
- Events / inbox / AGENT_NOTIFY.

## Report back

Issue URL, peer-stack demo URL, inline PNG of chip on session row, cold review vs `upstream/main`, draft `hapi-pr-create` readiness. Stop at merge-ready; do not merge.
