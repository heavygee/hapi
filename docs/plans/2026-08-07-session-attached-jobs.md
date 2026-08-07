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
  key, label, status: 'running'|'stalled'|'completed'|'failed',
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
- Feat tip: `e5237f366` (`feat/session-attached-jobs`) — SCHEMA V22 for upstream
- Soup tip: `driver/session-attached-jobs` @ V23 remumber; rematted to driver `b9fc58e41`
- Lidarr peer pinged to self-attach beets job
- **No upstream PR** until operator OK after Lidarr row is visibly truthful
