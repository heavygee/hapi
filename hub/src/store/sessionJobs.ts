import type { Database } from 'bun:sqlite'
import type { AttachedJob, AttachedJobPatch, AttachedJobStatus, AttachedJobUpsert } from '@hapi/protocol'

import type { StoredSessionJob } from './types'

/**
 * Per-session attached jobs (tiann/hapi#1404).
 *
 * Registration-first long-running work that outlives the agent process.
 * Hub is source of truth; list chrome reads the primary `running` job.
 *
 * Soup tip: SCHEMA_VERSION stays 23 (tolerate-ahead). Wake columns (#1489)
 * are ensured via ensureSessionJobWakeColumns — no schema bump required.
 */

type DbJobRow = {
    session_id: string
    job_key: string
    label: string
    status: string
    done: number | null
    total: number | null
    remaining: number | null
    unit: string | null
    detail: string | null
    wake_on_terminal: number | null
    wake_prompt: string | null
    wake_emitted_run_id: string | null
    heartbeat_at: number
    started_at: number
    updated_at: number
}

const JOB_COLUMNS = `session_id, job_key, label, status, done, total, remaining, unit, detail, wake_on_terminal, wake_prompt, wake_emitted_run_id, heartbeat_at, started_at, updated_at`

/** Defensive ALTERs for soup tips that keep SCHEMA_VERSION behind the live DB. */
export function ensureSessionJobWakeColumns(db: Database): void {
    const cols = db.prepare('PRAGMA table_info(session_jobs)').all() as Array<{ name: string }>
    if (cols.length === 0) return
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('wake_on_terminal')) {
        db.exec('ALTER TABLE session_jobs ADD COLUMN wake_on_terminal INTEGER NOT NULL DEFAULT 0')
    }
    if (!names.has('wake_prompt')) {
        db.exec('ALTER TABLE session_jobs ADD COLUMN wake_prompt TEXT')
    }
    if (!names.has('wake_emitted_run_id')) {
        db.exec('ALTER TABLE session_jobs ADD COLUMN wake_emitted_run_id TEXT')
    }
}

function toStored(row: DbJobRow): StoredSessionJob {
    return {
        sessionId: row.session_id,
        key: row.job_key,
        label: row.label,
        status: row.status as AttachedJobStatus,
        done: row.done ?? undefined,
        total: row.total ?? undefined,
        remaining: row.remaining ?? undefined,
        unit: row.unit ?? undefined,
        detail: row.detail ?? undefined,
        wakeOnTerminal: row.wake_on_terminal === 1,
        wakePrompt: row.wake_prompt ?? undefined,
        wakeEmittedRunId: row.wake_emitted_run_id ?? undefined,
        heartbeatAt: row.heartbeat_at,
        startedAt: row.started_at,
        updatedAt: row.updated_at
    }
}

export function toAttachedJob(job: StoredSessionJob): AttachedJob {
    return {
        key: job.key,
        label: job.label,
        status: job.status,
        ...(job.done !== undefined ? { done: job.done } : {}),
        ...(job.total !== undefined ? { total: job.total } : {}),
        ...(job.remaining !== undefined ? { remaining: job.remaining } : {}),
        ...(job.unit !== undefined ? { unit: job.unit } : {}),
        ...(job.detail !== undefined ? { detail: job.detail } : {}),
        ...(job.wakeOnTerminal ? { wakeOnTerminal: true } : {}),
        ...(job.wakePrompt !== undefined ? { wakePrompt: job.wakePrompt } : {}),
        heartbeatAt: job.heartbeatAt,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt
    }
}

export function listSessionJobs(db: Database, sessionId: string): StoredSessionJob[] {
    const rows = db.prepare(
        `SELECT ${JOB_COLUMNS}
         FROM session_jobs
         WHERE session_id = ?
         ORDER BY updated_at DESC, job_key ASC`
    ).all(sessionId) as DbJobRow[]
    return rows.map(toStored)
}

export function getSessionJob(
    db: Database,
    sessionId: string,
    jobKey: string
): StoredSessionJob | null {
    const row = db.prepare(
        `SELECT ${JOB_COLUMNS}
         FROM session_jobs
         WHERE session_id = ? AND job_key = ?`
    ).get(sessionId, jobKey) as DbJobRow | undefined
    return row ? toStored(row) : null
}

/** Earliest-started `running` job for a session, or null (stable list chrome). */
export function getPrimaryRunningJob(db: Database, sessionId: string): StoredSessionJob | null {
    const row = db.prepare(
        `SELECT ${JOB_COLUMNS}
         FROM session_jobs
         WHERE session_id = ? AND status = 'running'
         ORDER BY started_at ASC, job_key ASC
         LIMIT 1`
    ).get(sessionId) as DbJobRow | undefined
    return row ? toStored(row) : null
}

/**
 * Batch primary running jobs for session list enrichment.
 * Returns Map sessionId → AttachedJob.
 */
export function getPrimaryRunningJobsBySessionIds(
    db: Database,
    sessionIds: string[]
): Map<string, AttachedJob> {
    const result = new Map<string, AttachedJob>()
    if (sessionIds.length === 0) return result

    const placeholders = sessionIds.map(() => '?').join(', ')
    const rows = db.prepare(
        `SELECT ${JOB_COLUMNS}
         FROM session_jobs
         WHERE status = 'running' AND session_id IN (${placeholders})
         ORDER BY started_at ASC, job_key ASC`
    ).all(...sessionIds) as DbJobRow[]

    for (const row of rows) {
        if (result.has(row.session_id)) continue
        result.set(row.session_id, toAttachedJob(toStored(row)))
    }
    return result
}

export type UpsertSessionJobResult =
    | { outcome: 'upserted'; job: StoredSessionJob }
    | { outcome: 'session-not-found' }

export function upsertSessionJob(
    db: Database,
    sessionId: string,
    jobKey: string,
    body: AttachedJobUpsert,
    now: number = Date.now()
): UpsertSessionJobResult {
    const existing = getSessionJob(db, sessionId, jobKey)
    const heartbeatAt = body.heartbeatAt ?? now
    const startedAt = body.startedAt !== undefined
        ? body.startedAt
        : (existing?.startedAt ?? now)
    const status = body.status ?? 'running'
    const wakeOnTerminal = body.wakeOnTerminal === true ? 1 : 0
    const wakePrompt = body.wakePrompt ?? null
    // New generation (explicit startedAt change or back to running) clears prior claim.
    const clearWakeClaim =
        (body.startedAt !== undefined && body.startedAt !== existing?.startedAt)
        || (status === 'running' && existing !== null && existing.status !== 'running')

    try {
        db.prepare(
            `INSERT INTO session_jobs (
                session_id, job_key, label, status, done, total, remaining, unit, detail,
                wake_on_terminal, wake_prompt, wake_emitted_run_id,
                heartbeat_at, started_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
             ON CONFLICT(session_id, job_key) DO UPDATE SET
                label = excluded.label,
                status = excluded.status,
                done = excluded.done,
                total = excluded.total,
                remaining = excluded.remaining,
                unit = excluded.unit,
                detail = excluded.detail,
                wake_on_terminal = excluded.wake_on_terminal,
                wake_prompt = excluded.wake_prompt,
                wake_emitted_run_id = CASE
                    WHEN ? THEN NULL
                    ELSE session_jobs.wake_emitted_run_id
                END,
                heartbeat_at = excluded.heartbeat_at,
                started_at = excluded.started_at,
                updated_at = excluded.updated_at`
        ).run(
            sessionId,
            jobKey,
            body.label,
            status,
            body.done ?? null,
            body.total ?? null,
            body.remaining ?? null,
            body.unit ?? null,
            body.detail ?? null,
            wakeOnTerminal,
            wakePrompt,
            heartbeatAt,
            startedAt,
            now,
            clearWakeClaim ? 1 : 0
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('FOREIGN KEY') || message.includes('foreign key')) {
            return { outcome: 'session-not-found' }
        }
        throw error
    }

    const job = getSessionJob(db, sessionId, jobKey)
    if (!job) {
        return { outcome: 'session-not-found' }
    }
    return { outcome: 'upserted', job }
}

export function patchSessionJob(
    db: Database,
    sessionId: string,
    jobKey: string,
    patch: AttachedJobPatch,
    now: number = Date.now()
): StoredSessionJob | null {
    const existing = getSessionJob(db, sessionId, jobKey)
    if (!existing) return null

    const next: StoredSessionJob = {
        ...existing,
        label: patch.label ?? existing.label,
        status: patch.status ?? existing.status,
        done: patch.done === null ? undefined : (patch.done ?? existing.done),
        total: patch.total === null ? undefined : (patch.total ?? existing.total),
        remaining: patch.remaining === null ? undefined : (patch.remaining ?? existing.remaining),
        unit: patch.unit === null ? undefined : (patch.unit ?? existing.unit),
        detail: patch.detail === null ? undefined : (patch.detail ?? existing.detail),
        wakeOnTerminal: patch.wakeOnTerminal ?? existing.wakeOnTerminal,
        wakePrompt: patch.wakePrompt === null
            ? undefined
            : (patch.wakePrompt ?? existing.wakePrompt),
        heartbeatAt: patch.heartbeatAt ?? now,
        updatedAt: now
    }

    db.prepare(
        `UPDATE session_jobs SET
            label = ?, status = ?, done = ?, total = ?, remaining = ?, unit = ?, detail = ?,
            wake_on_terminal = ?, wake_prompt = ?,
            heartbeat_at = ?, updated_at = ?
         WHERE session_id = ? AND job_key = ?`
    ).run(
        next.label,
        next.status,
        next.done ?? null,
        next.total ?? null,
        next.remaining ?? null,
        next.unit ?? null,
        next.detail ?? null,
        next.wakeOnTerminal ? 1 : 0,
        next.wakePrompt ?? null,
        next.heartbeatAt,
        next.updatedAt,
        sessionId,
        jobKey
    )

    return getSessionJob(db, sessionId, jobKey)
}

/**
 * Atomically claim a one-shot terminal wake (#1489).
 * Claim id is startedAt-based on this soup tip (no run_id fence yet).
 */
export function claimSessionJobTerminalWake(
    db: Database,
    sessionId: string,
    jobKey: string
): StoredSessionJob | null {
    const existing = getSessionJob(db, sessionId, jobKey)
    if (!existing) return null
    if (!existing.wakeOnTerminal) return null
    if (existing.status !== 'completed' && existing.status !== 'failed') return null
    const claimId = `norun:${existing.startedAt}`
    if (existing.wakeEmittedRunId === claimId) return null

    const result = db.prepare(
        `UPDATE session_jobs SET wake_emitted_run_id = ?
         WHERE session_id = ? AND job_key = ?
           AND wake_on_terminal = 1
           AND status IN ('completed', 'failed')
           AND (
             wake_emitted_run_id IS NULL
             OR wake_emitted_run_id != ?
           )`
    ).run(claimId, sessionId, jobKey, claimId)

    if (result.changes === 0) return null
    return getSessionJob(db, sessionId, jobKey)
}

export function deleteSessionJob(db: Database, sessionId: string, jobKey: string): boolean {
    const result = db.prepare(
        'DELETE FROM session_jobs WHERE session_id = ? AND job_key = ?'
    ).run(sessionId, jobKey)
    return result.changes > 0
}

/**
 * Re-point jobs during session merge (same contract as scratchlist transfer).
 * Call BEFORE deleteSession so CASCADE does not race the move.
 */
export function transferSessionJobs(
    db: Database,
    fromSessionId: string,
    toSessionId: string
): { moved: number; collided: number } {
    const rows = listSessionJobs(db, fromSessionId)
    let moved = 0
    let collided = 0

    for (const job of rows) {
        const existing = getSessionJob(db, toSessionId, job.key)
        if (existing) {
            db.prepare('DELETE FROM session_jobs WHERE session_id = ? AND job_key = ?')
                .run(fromSessionId, job.key)
            collided += 1
            continue
        }
        db.prepare(
            `UPDATE session_jobs SET session_id = ?
             WHERE session_id = ? AND job_key = ?`
        ).run(toSessionId, fromSessionId, job.key)
        moved += 1
    }

    return { moved, collided }
}
