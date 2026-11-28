/**
 * Generation-keyed durable live-work (#2658).
 *
 * One record per worker owner. Map keys are
 * `liveWorkOwnerKey(machineId, hostPid, hostStartMarker)` — hostStartMarker is
 * the generation identity used everywhere else; machineId + hostPid complete the
 * owner so same-second start markers cannot merge distinct PIDs.
 *
 * Any entry with work blocks destroy-state callers. Clear of a prior owner on
 * runner-owned sessions requires PID+marker ProbeSessionExit `already_gone`.
 *
 * Durable writes are runner-owned only. Terminal / imported rows keep transient
 * thinking / backgroundTask lifecycle — they never enter the keyed probe path.
 *
 * Acceptance: the archive / live-work coverage tables (prior-gen still_alive
 * refuse; PID+marker already_gone clear; runner-owned hostPid scope; legacy
 * read-path project; report-bound write attribution) are criteria, not
 * decoration — #2021 must not regress them when it rebases onto this model.
 */

import type { BackgroundTask, Session } from '@hapi/protocol/types'

export type LiveWorkGenerationEntry = {
    machineId: string
    hostPid?: number
    /** Process start marker for ProbeSessionExit (may differ from map key). */
    hostStartMarker?: string
    since: number
    unresolvedTurn?: boolean
    backgroundTasks?: BackgroundTask[]
}

export type LiveWorkByGeneration = Record<string, LiveWorkGenerationEntry>

/** Reserved key when the reporting worker has no hostStartMarker (fail closed). */
export const UNKNOWN_GENERATION_KEY = '__unknown__'

export function isRunnerOwnedSession(session: Session | { metadata?: Session['metadata'] } | null | undefined): boolean {
    const meta = session?.metadata
    return Boolean(meta?.codexResumePending)
        || meta?.startedBy === 'runner'
        || meta?.startedFromRunner === true
}

/** Owner map key: generation marker plus the PID/machine the probe already uses. */
export function liveWorkOwnerKey(opts: {
    machineId: string
    hostPid: number
    hostStartMarker: string
}): string {
    return `${opts.machineId}:${opts.hostPid}:${opts.hostStartMarker}`
}

export function generationEntryHasWork(entry: LiveWorkGenerationEntry | null | undefined): boolean {
    if (!entry) return false
    if (entry.unresolvedTurn === true) return true
    return Array.isArray(entry.backgroundTasks) && entry.backgroundTasks.length > 0
}

export function liveWorkByGenerationHasWork(map: LiveWorkByGeneration | null | undefined): boolean {
    if (!map) return false
    for (const entry of Object.values(map)) {
        if (generationEntryHasWork(entry)) return true
    }
    return false
}

export function resolveEntryProbeMarker(ownerKey: string, entry: LiveWorkGenerationEntry): string {
    if (typeof entry.hostStartMarker === 'string' && entry.hostStartMarker.length > 0) {
        return entry.hostStartMarker
    }
    // Legacy marker-only keys from early seeds / read-path projection.
    return ownerKey
}

function projectOneLegacyLatch(
    _metadata: NonNullable<Session['metadata']>,
    marker: string,
    opts: { unresolvedTurn?: boolean; backgroundTasks?: BackgroundTask[]; since: number },
): { key: string; entry: LiveWorkGenerationEntry } {
    // Never attach the current row's machine/pid from marker equality alone —
    // Unix markers are second-precision, so a same-second replacement can match
    // and then clear the prior latch on its first idle heartbeat (#2658).
    // Legacy stays blocking and not probe-clearable until report-bound writes
    // materialize a real owner key.
    return {
        key: marker,
        entry: {
            machineId: '',
            ...(marker !== UNKNOWN_GENERATION_KEY ? { hostStartMarker: marker } : {}),
            since: opts.since,
            ...(opts.unresolvedTurn ? { unresolvedTurn: true as const } : {}),
            ...(opts.backgroundTasks && opts.backgroundTasks.length > 0
                ? { backgroundTasks: opts.backgroundTasks }
                : {}),
        },
    }
}

/**
 * Project legacy single-slot `unresolvedTurn` / `backgroundWork` into the keyed
 * map when the keyed field is absent (read-path only; no backfill job).
 * Turn and background keep separate owners when their markers differ.
 */
export function projectLegacyLiveWork(
    metadata: Session['metadata'] | null | undefined,
): LiveWorkByGeneration {
    if (!metadata) return {}
    const keyed = metadata.liveWorkByGeneration
    if (keyed && typeof keyed === 'object' && !Array.isArray(keyed)) {
        return { ...keyed }
    }

    const out: LiveWorkByGeneration = {}
    const legacyTurn = metadata.unresolvedTurn
    const legacyBg = metadata.backgroundWork
    const turnMarkerRaw = legacyTurn && typeof legacyTurn === 'object'
        ? legacyTurn.hostStartMarker
        : undefined
    const bgMarkerRaw = legacyBg && typeof legacyBg === 'object'
        ? legacyBg.hostStartMarker
        : undefined
    // Markerless latches stay under UNKNOWN — never inherit the current row's
    // marker/pid (that would let B's verified exit clear A's work).
    const turnMarker = (typeof turnMarkerRaw === 'string' && turnMarkerRaw.length > 0)
        ? turnMarkerRaw
        : UNKNOWN_GENERATION_KEY
    const bgMarker = (typeof bgMarkerRaw === 'string' && bgMarkerRaw.length > 0)
        ? bgMarkerRaw
        : UNKNOWN_GENERATION_KEY

    const hasTurn = Boolean(legacyTurn && typeof legacyTurn === 'object')
    const tasks = legacyBg && typeof legacyBg === 'object' && Array.isArray(legacyBg.tasks)
        ? legacyBg.tasks as BackgroundTask[]
        : []
    if (!hasTurn && tasks.length === 0) return out

    if (hasTurn) {
        const projected = projectOneLegacyLatch(metadata, turnMarker, {
            unresolvedTurn: true,
            since: (typeof legacyTurn === 'object' && typeof legacyTurn.since === 'number')
                ? legacyTurn.since
                : Date.now(),
            // Same marker: fold bg into the turn entry; different → separate below.
            ...(turnMarker === bgMarker && tasks.length > 0 ? { backgroundTasks: tasks } : {}),
        })
        out[projected.key] = projected.entry
    }

    if (tasks.length > 0 && (!hasTurn || bgMarker !== turnMarker)) {
        const projected = projectOneLegacyLatch(metadata, bgMarker, {
            backgroundTasks: tasks,
            since: Date.now(),
        })
        const existing = out[projected.key]
        if (existing) {
            out[projected.key] = {
                ...existing,
                backgroundTasks: tasks,
            }
        } else {
            out[projected.key] = projected.entry
        }
    }

    return out
}

export function resolveLiveWorkByGeneration(session: Session): LiveWorkByGeneration {
    return projectLegacyLiveWork(session.metadata)
}

/**
 * Entry can be cleared via PID+marker ProbeSessionExit.
 * Ownership is on the *entry* (runner durable writes stamp machineId+hostPid),
 * not the current row's `startedBy` — a terminal resume must not hide a prior
 * runner generation from the probe path (#2658).
 */
export function generationEntryProbeClearable(
    _session: Session,
    ownerKey: string,
    entry: LiveWorkGenerationEntry,
): boolean {
    const marker = resolveEntryProbeMarker(ownerKey, entry)
    if (marker === UNKNOWN_GENERATION_KEY || marker.length === 0) return false
    if (typeof entry.machineId !== 'string' || entry.machineId.length === 0) return false
    if (typeof entry.hostPid !== 'number' || entry.hostPid <= 0) return false
    return generationEntryHasWork(entry)
}
