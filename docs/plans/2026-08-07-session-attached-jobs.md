# Session-attached long-running jobs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hub-persisted, registration-first session jobs that stay visible on the session list while the agent is idle.

**Architecture:** New `session_jobs` SQLite table (scratchlist-shaped). REST upsert/update/clear under `/api/sessions/:id/jobs`. Mutations emit `session-updated` SSE patches carrying `attachedJob` (primary running job summary) so the list cache updates without N+1. CLI `hapi job` uses the same JWT auth as ping-peer. Web row chrome shows label + honest fraction/remaining or indeterminate heartbeat; works when `active: false`.

**Tech Stack:** Bun workspaces, Zod (`@hapi/protocol`), better-sqlite3/bun:sqlite, Hono routes, TanStack Query + SSE, Vitest.

**Upstream issue:** https://github.com/tiann/hapi/issues/1404

**Worktree:** `~/coding/hapi/worktrees/session-attached-jobs` @ `feat/session-attached-jobs`

**Dogfood consumer:** `/sessions/ec8d1d4e-63aa-45d2-83eb-78b5b776514b` (Lidarr/beets)

---

## Friction (architecture)

- **Table vs metadata JSON:** metadataVersion CAS fights heartbeat spam; agent offline cannot socket-update. Table + hub REST wins.
- **Kill criteria:** if list enrichment costs >5ms on 500 sessions, denormalize primary job onto `sessions` row.
- **Not backgroundTaskCount:** that is in-agent Claude Ctrl+B style; dies with disconnect. Different feature.

## A2A / overseer alignment (RFC v2, 2026-08-04)

Canon: `docs/plans/2026-08-03-a2a-control-plane-rfc.md` + [#1332](https://github.com/tiann/hapi/discussions/1332). P1 ledger WIP: worktree `a2a-p1-ledger` / peer `e1ee1785` (`/work-graph/events`). Overseer prep (`a492a270`) inherits RFC v2 principal / Bounds / `expires_at` semantics - **no #1404 conflation in that thread yet**.

| Concern | Decision |
|---------|----------|
| Same table as `work_ad`? | **No.** `session_jobs` vs work-graph `events`. Jobs are Layer 0 `SessionSummary.attachedJob` enrichment. |
| Google A2A `Task`? | **No.** External interop protocol; HAPI A2A is hub-mediated control plane. |
| Auto-emit `work_ad` from heartbeats? | **No (kill).** Floods ledger with mechanical progress; overseer contracts treat routine progress as captured-only; violates "notify optional indefinitely"; confuses status vocab. Privileged reader may *observe* `attachedJob` later. |
| Staleness | Aligns: UI amber after 15m silence; status stays `running` until explicit completed/failed. Mirrors RFC: silence → stale presentation, not failure / not `incomplete` handoff timeout-as-fail. |
| Status vocab | Jobs: hub-owned `running` \| `completed` \| `failed` only. UI "stale" is presentation. Do **not** add `stalled` as a stored status (plan sketch below was wrong). Map to work_ad only if a future projection exists: running→`in_progress`, completed→`done`, failed→`failed`, amber silence→`stale`. |
| `AGENT_NOTIFY_SUMMARY` | Remains optional turn self-report for Layer 1 ads (P3). Jobs do not replace it. `job run` exit code ≈ receipt `checks[]` fact style for the **process meter**, not a ledger receipt. |
| Principal on job rows | Not required for Layer 0 session enrichment (JWT like ping-peer). If projecting to `work_ad`, add structured principal then - do not pre-bake. |
| One Boss / Bounds | Hub REST only; workers must not treat jobs or ledger as a self-service work queue. |

**Friction:** temptation to "unify progress" into one object. Steelmans: one vocabulary for overseer. Kill: overseer needs collaboration claims + attention sidecar; Lidarr needs a dumb process meter that works when the agent is dead and has never heard of A2A. Cheapest falsification: keep stores separate; dogfood both; only bridge if a privileged reader actually needs a join.

**ACK (2026-08-07):** Overseer / A2A substrate session confirmed **no divergence** with RFC v2 / P1. Ship Layer 0 jobs without waiting on A2A P1 (#1374). Deliberate ledger rows for a job milestone (if ever) = explicit `work_ad`/`handoff` write, never heartbeat promotion.

**Dogfood (2026-08-08, music `ec8d1d4e` / beets):** UI confirmed for unit counts + elapsed from `startedAt`. Gotcha: PATCH rejects `startedAt`; old PUT ignored corrections on existing rows → clear+PUT with true epoch ms fixed elapsed (`9d 6h` vs ~1h attach). Fix landed: PUT honors explicit `startedAt`; CLI `--started-at`; docs recipe for clear+set. Drain ALL_DONE 1787/1787.

## UI options (reveal before lock)

1. **Meter under title** — thin bar + `beets · 91%` / `823 left`; pulse when heartbeat fresh; amber when stale (>15m).
2. **Right chip** — todo-style `823 left` / `♥ 2h` on the trailing column; no bar.

Ship option 1 as default (fraction-first per UX research); option 2 if density complains.

---

### Task 1: Shared types

**Files:**
- Modify: `shared/src/schemas.ts`, `shared/src/sessionSummary.ts`, `shared/src/types.ts`
- Test: `shared/src/sessionSummary.test.ts`, `shared/src/schemas.sessionPatch.test.ts`

**Schema sketch:**

```ts
AttachedJobSchema = {
  key, label, status: 'running'|'completed'|'failed',  // UI amber = stale heartbeat, not a status
  done?: number, total?: number, remaining?: number, unit?: string,
  detail?: string, heartbeatAt, startedAt, updatedAt
}
```

SessionSummary + SessionPatch get `attachedJob: AttachedJob | null` (optional on patch).

### Task 2: Hub store V21→V22

**Files:**
- Create: `hub/src/store/sessionJobs.ts`, `hub/src/store/sessionJobsStore.ts`, `hub/src/store/migration-v22.test.ts`
- Modify: `hub/src/store/index.ts`, `hub/src/store/types.ts`

Table `session_jobs (session_id, job_key PK, label, status, done, total, remaining, unit, detail, heartbeat_at, started_at, updated_at)` + cascade delete + transfer-on-merge.

### Task 3: SyncEngine + REST

**Files:**
- Modify: `hub/src/sync/syncEngine.ts`, `hub/src/web/routes/sessions.ts`, list enrichment
- Test: `hub/src/web/routes/sessions-jobs.test.ts`, sync tests

Routes:
- `GET /sessions/:id/jobs`
- `PUT /sessions/:id/jobs/:jobKey` upsert
- `PATCH /sessions/:id/jobs/:jobKey` progress/heartbeat
- `DELETE /sessions/:id/jobs/:jobKey`

### Task 4: CLI `hapi job`

**Files:**
- Create: `cli/src/commands/job.ts`, `cli/src/modules/sessionJob/sessionJob.ts` (+ tests)
- Modify: `cli/src/commands/registry.ts`

Subcommands: `set`, `update`, `clear`, `list` — same auth as ping-peer.

### Task 5: Web chrome

**Files:**
- Modify: `web/src/components/SessionRowSummary.tsx`, locales, `useSSE.ts`, api types
- Test: component / summary tests

### Task 6: Dogfood

Soup promote + `hapi-ping-peer` Lidarr session with attach recipe. No upstream PR until operator OK.


## Status (2026-08-07)

- Upstream issue: https://github.com/tiann/hapi/issues/1404
- Feat tip: `feat/session-attached-jobs` — SCHEMA V22 for upstream
- Soup tip: rematted with guidance+elapsed; dogfood OK on `:3006`
- Opus cold review (`eb1746db`, tip `266965f8a`): **ship with fixes — Ready-for-PR: NO**
  - Majors: idle-agent heartbeat gap → `hapi job run` supervisor; post-merge `$HAPI_SESSION_ID` 404 → job-owner redirects; CLI test gap; steer only 4/10 flavors (no MCP yet)
  - Discoverability ~40% attach / ~20% sustained without coaching
- Process: peer briefs must ping originator on completion (spawn-peer skill + intake §0)
- Cold-review Majors fixed on feat tip (incl. `job run`, post-merge redirects, CLI tests, steer scoping)
- A2A alignment documented (Layer 0 meter ≠ Layer 1 `work_ad`); guide + AGENTS + estate skill updated
- **No upstream PR** until operator OK after dogfood of `job run`

### Remaining backlog

1. MCP `hapi_job` tool (Cursor/ACP discoverability)
2. Terminal-job TTL / reclaim
3. Second cold pass after `job run` dogfood — **in flight** peer `1a710632` (brief `docs/plans/peer-briefings/2026-08-08-peer-cold-review-session-jobs-pass2.md`, tip `954279b8a`)
4. Optional later: privileged reader join of `attachedJob` → work-ad projection (not auto-heartbeat ingest)
