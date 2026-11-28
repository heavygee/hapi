/**
 * Heartbeat a session-attached job while watching an already-running PID.
 * Covers late attach when the process was started before `hapi job run`.
 */

import { randomUUID } from 'node:crypto'
import type { AttachedJobUpsert } from '@hapi/protocol'
import {
    SessionJobError,
    resolveSessionJobClient,
    setSessionJob,
    updateSessionJob,
    type SessionJobClientOptions,
    type SessionJobResolvedClient
} from './sessionJob'
import { stampUntilProgress } from './jobProgressMode'

const DEFAULT_HEARTBEAT_MS = 60_000
const DEFAULT_POLL_MS = 2_000

export type AttachSessionJobOptions = SessionJobClientOptions & {
    jobKey: string
    label: string
    pid: number
    heartbeatMs?: number
    pollMs?: number
    remaining?: number
    done?: number
    total?: number
    unit?: string
    detail?: string
    untilMs?: number
    startedAtMs?: number
    wakeOnTerminal?: boolean
    wakePrompt?: string
    /** Injected for tests. */
    setIntervalImpl?: typeof setInterval
    clearIntervalImpl?: typeof clearInterval
    sleepImpl?: (ms: number) => Promise<void>
    nowImpl?: () => number
    /** Injected for tests — return true while the process is alive. */
    isAliveImpl?: (pid: number) => boolean
    /** Called after hub set succeeds (detach / observability). */
    onRegistered?: (info: { jobKey: string; runId: string; sessionId: string }) => void
}

function defaultIsAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false
    }
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        const err = error as NodeJS.ErrnoException
        // EPERM: process exists but we cannot signal it — still alive for attach.
        if (err.code === 'EPERM') {
            return true
        }
        return false
    }
}

export async function attachSessionJob(options: AttachSessionJobOptions): Promise<number> {
    if (!Number.isInteger(options.pid) || options.pid <= 0) {
        throw new SessionJobError('bad_args', '--pid must be a positive integer')
    }

    const isAlive = options.isAliveImpl ?? defaultIsAlive
    if (!isAlive(options.pid)) {
        throw new SessionJobError(
            'bad_args',
            `pid ${options.pid} is not running — refuse attach to a dead process`
        )
    }

    const runId = randomUUID()
    const body: AttachedJobUpsert = {
        label: options.label,
        status: 'running',
        runId,
        ...(options.done !== undefined ? { done: options.done } : {}),
        ...(options.total !== undefined ? { total: options.total } : {}),
        ...(options.remaining !== undefined ? { remaining: options.remaining } : {}),
        ...(options.unit !== undefined ? { unit: options.unit } : {}),
        ...(options.detail !== undefined ? { detail: options.detail } : {}),
        ...(options.startedAtMs !== undefined ? { startedAt: options.startedAtMs } : {}),
        ...(options.wakeOnTerminal !== undefined ? { wakeOnTerminal: options.wakeOnTerminal } : {}),
        ...(options.wakePrompt !== undefined ? { wakePrompt: options.wakePrompt } : {})
    }

    console.error(
        `[hapi job attach] starting key=${options.jobKey} pid=${options.pid} `
        + `(will heartbeat until the process exits)`
    )

    const resolved: SessionJobResolvedClient = await resolveSessionJobClient(options)
    const clientOpts = {
        sessionIdPrefix: options.sessionIdPrefix,
        resolved,
        accessToken: options.accessToken,
        apiUrl: options.apiUrl,
        http: options.http
    }

    await setSessionJob({
        ...clientOpts,
        jobKey: options.jobKey,
        body
    })

    console.error(
        `[hapi job attach] registered key=${options.jobKey} runId=${runId} `
        + `session=${resolved.sessionId}`
    )
    options.onRegistered?.({
        jobKey: options.jobKey,
        runId,
        sessionId: resolved.sessionId
    })

    const setIntervalFn = options.setIntervalImpl ?? setInterval
    const clearIntervalFn = options.clearIntervalImpl ?? clearInterval
    const sleep = options.sleepImpl
        ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const now = options.nowImpl ?? Date.now
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS
    const untilWindowStartMs = options.startedAtMs ?? now()
    const untilMs = options.untilMs

    let loggedHeartbeatFailure = false
    let inflightHeartbeat: Promise<unknown> = Promise.resolve()
    const heartbeat = setIntervalFn(() => {
        const untilBody = untilMs !== undefined
            ? (() => {
                const stamped = stampUntilProgress(untilMs, now(), untilWindowStartMs)
                return {
                    remaining: stamped.remaining,
                    total: stamped.total,
                    unit: options.unit ?? stamped.unit
                }
            })()
            : {}
        inflightHeartbeat = updateSessionJob({
            ...clientOpts,
            jobKey: options.jobKey,
            body: { expectedRunId: runId, ...untilBody }
        }).catch((error: unknown) => {
            if (!loggedHeartbeatFailure) {
                loggedHeartbeatFailure = true
                const message = error instanceof Error ? error.message : String(error)
                console.error(`[hapi job attach] heartbeat failed (will keep trying): ${message}`)
            }
        })
    }, heartbeatMs)
    heartbeat.unref?.()

    while (isAlive(options.pid)) {
        await sleep(pollMs)
    }

    clearIntervalFn(heartbeat)
    await inflightHeartbeat.catch(() => undefined)

    // Exit code of an unrelated process is not available without being the parent.
    try {
        await updateSessionJob({
            ...clientOpts,
            jobKey: options.jobKey,
            body: {
                expectedRunId: runId,
                status: 'completed',
                detail: `pid ${options.pid} exited (exit code unknown — attach is not the parent)`
            }
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[hapi job attach] failed to mark job completed: ${message}`)
        return 1
    }

    console.error(`[hapi job attach] finished key=${options.jobKey} pid=${options.pid}`)
    return 0
}
