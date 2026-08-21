import type { Database } from 'bun:sqlite'

import type { StoredMachine, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'
import { constantTimeEquals } from '../utils/crypto'
import { hashRunnerProof, verifyRunnerProof } from '../utils/runnerProof'

type DbMachineRow = {
    id: string
    namespace: string
    tag: string | null
    runner_proof_hash: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    runner_state: string | null
    runner_state_version: number
    active: number
    active_at: number | null
    seq: number
}

function toStoredMachine(row: DbMachineRow): StoredMachine {
    return {
        id: row.id,
        namespace: row.namespace,
        tag: typeof row.tag === 'string' && row.tag.trim() ? row.tag.trim() : null,
        runnerProofHash: typeof row.runner_proof_hash === 'string' && row.runner_proof_hash.trim()
            ? row.runner_proof_hash.trim()
            : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        runnerState: safeJsonParse(row.runner_state),
        runnerStateVersion: row.runner_state_version,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Rows created before the CLI reported full metadata (or by older versions)
// would keep missing fields like `host` forever — get-or-create returns the
// existing row untouched and every client hits it on startup. Merge incoming
// machine-owned fields over the stored ones so registration doubles as a
// refresh; hub-side fields the CLI never sends (e.g. displayName) survive.
// Returns undefined when the merge would not change anything.
//
// When `clearOmittedRunnerAds` is set (full runner daemon registration with
// runnerState), runner-advertised keys omitted from incoming are deleted so
// rollback / unsupervised restart cannot leave sticky capabilities or
// supervisedRestart:true (#1108 bot Major).
export const RUNNER_ADVERTISED_METADATA_KEYS = [
    'capabilities',
    'supervisedRestart',
    'startedCliMtimeMs',
    'installedCliMtimeMs',
] as const

export function mergeMachineMetadata(
    stored: unknown,
    incoming: unknown,
    options?: { clearOmittedRunnerAds?: boolean },
): Record<string, unknown> | undefined {
    if (!isPlainObject(incoming)) return undefined
    const base = isPlainObject(stored) ? stored : {}
    const merged: Record<string, unknown> = { ...base, ...incoming }
    if (options?.clearOmittedRunnerAds) {
        for (const key of RUNNER_ADVERTISED_METADATA_KEYS) {
            if (!(key in incoming)) {
                delete merged[key]
            }
        }
    }
    return JSON.stringify(merged) === JSON.stringify(base) ? undefined : merged
}

// Registration also carries the runner's self-declared capabilities (e.g.
// `piExistingSessionResume`), but live fields of runner_state (status, pid,
// startedAt, ...) are owned by the socket heartbeat and must not be clobbered
// by an HTTP registration. For machines created before a capability existed,
// the upgrade would otherwise never be observed: get-or-create returns the
// existing row untouched and the socket heartbeat only replays what the hub
// already persisted. Merge only the capability set, leaving everything else
// socket-owned. Returns undefined when nothing changes.
function mergeRunnerCapabilities(stored: unknown, incoming: unknown): Record<string, unknown> | undefined {
    if (!isPlainObject(incoming)) return undefined
    const incomingCaps = incoming.capabilities
    if (!isPlainObject(incomingCaps) || Object.keys(incomingCaps).length === 0) return undefined
    const base = isPlainObject(stored) ? stored : {}
    const currentCaps = isPlainObject(base.capabilities) ? base.capabilities : {}
    const mergedCaps = { ...currentCaps, ...incomingCaps }
    return JSON.stringify(mergedCaps) === JSON.stringify(currentCaps) ? undefined : { ...base, capabilities: mergedCaps }
}

export class MachineTagConflictError extends Error {
    constructor(message = 'Machine tag mismatch') {
        super(message)
        this.name = 'MachineTagConflictError'
    }
}

export function getOrCreateMachine(
    db: Database,
    id: string,
    metadata: unknown,
    runnerState: unknown,
    namespace: string,
    tag?: string,
    runnerProof?: string
): StoredMachine {
    const presentedTag = typeof tag === 'string' ? tag.trim() : ''
    const presentedProof = typeof runnerProof === 'string' ? runnerProof.trim() : ''
    const existing = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
    if (existing) {
        const stored = toStoredMachine(existing)
        if (stored.namespace !== namespace) {
            throw new Error('Machine namespace mismatch')
        }
        let current = stored
        // Tagged rows require the create-time secret on every registration;
        // omitting tag must not refresh metadata/capabilities (#1473 Major).
        // Untagged legacy rows refuse first-claim bind — re-enroll with a new id.
        if (current.tag) {
            if (!presentedTag || !constantTimeEquals(current.tag, presentedTag)) {
                throw new MachineTagConflictError()
            }
        } else if (presentedTag) {
            throw new MachineTagConflictError(
                'Legacy machine must be re-enrolled with a new machine id'
            )
        }
        // Bound rows require the runner proof on every registration (#1473 Major).
        // Omitting proof must not refresh metadata/capabilities. Null-hash rows
        // refuse late bind — re-enroll with a new machine id (INSERT binds hash).
        // Wrong proof always fails closed — no tag-only offline rebind (Codex
        // Blocker: same-UID siblings can read machineTag from settings.json).
        // Runner proof stays memory-only on the CLI; cold restart may rotate
        // machine id rather than rebind from a disk bearer.
        if (current.runnerProofHash) {
            if (!presentedProof || !verifyRunnerProof(presentedProof, current.runnerProofHash)) {
                throw new MachineTagConflictError(
                    'Machine runner proof mismatch; re-enroll with a new machine id'
                )
            }
        } else if (presentedProof) {
            throw new MachineTagConflictError(
                'Machine runner proof missing; re-enroll with a new machine id'
            )
        }
        const merged = mergeMachineMetadata(current.metadata, metadata, {
            // Full runner registration (with runnerState) owns the skew ads —
            // omit means clear, so rollback cannot leave sticky supervisedRestart.
            // After tag/proof gates so a failed auth cannot refresh ads (#1473).
            clearOmittedRunnerAds: runnerState !== null && runnerState !== undefined,
        })
        if (merged !== undefined) {
            db.prepare(`
                UPDATE machines
                SET metadata = @metadata,
                    metadata_version = metadata_version + 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id
            `).run({
                metadata: JSON.stringify(merged),
                updated_at: Date.now(),
                id
            })
            const row = getMachine(db, id)
            if (!row) {
                throw new Error('Failed to refresh machine metadata')
            }
            current = row
        }
        const mergedRunnerState = mergeRunnerCapabilities(current.runnerState, runnerState)
        if (mergedRunnerState !== undefined) {
            db.prepare(`
                UPDATE machines
                SET runner_state = @runner_state,
                    runner_state_version = runner_state_version + 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id
            `).run({
                runner_state: JSON.stringify(mergedRunnerState),
                updated_at: Date.now(),
                id
            })
            const row = getMachine(db, id)
            if (!row) {
                throw new Error('Failed to refresh machine runner state')
            }
            current = row
        }
        return current
    }

    const now = Date.now()
    const metadataJson = JSON.stringify(metadata)
    const runnerStateJson = runnerState === null || runnerState === undefined ? null : JSON.stringify(runnerState)

    db.prepare(`
        INSERT INTO machines (
            id, namespace, tag, runner_proof_hash, created_at, updated_at,
            metadata, metadata_version,
            runner_state, runner_state_version,
            active, active_at, seq
        ) VALUES (
            @id, @namespace, @tag, @runner_proof_hash, @created_at, @updated_at,
            @metadata, 1,
            @runner_state, 1,
            0, NULL, 0
        )
    `).run({
        id,
        namespace,
        tag: presentedTag || null,
        runner_proof_hash: presentedProof ? hashRunnerProof(presentedProof) : null,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        runner_state: runnerStateJson
    })

    const row = getMachine(db, id)
    if (!row) {
        throw new Error('Failed to create machine')
    }
    return row
}

export function updateMachineMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()

    return updateVersionedField({
        db,
        table: 'machines',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

export function updateMachineRunnerState(
    db: Database,
    id: string,
    runnerState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = runnerState ?? null

    return updateVersionedField({
        db,
        table: 'machines',
        id,
        namespace,
        field: 'runner_state',
        versionField: 'runner_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: [
            'updated_at = @updated_at',
            'active = 1',
            'active_at = @active_at',
            'seq = seq + 1'
        ],
        params: { updated_at: now, active_at: now }
    })
}

export function getMachine(db: Database, id: string): StoredMachine | null {
    const row = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
    return row ? toStoredMachine(row) : null
}

export function getMachineByNamespace(db: Database, id: string, namespace: string): StoredMachine | null {
    const row = db.prepare(
        'SELECT * FROM machines WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbMachineRow | undefined
    return row ? toStoredMachine(row) : null
}

export function getMachines(db: Database): StoredMachine[] {
    const rows = db.prepare('SELECT * FROM machines ORDER BY updated_at DESC').all() as DbMachineRow[]
    return rows.map(toStoredMachine)
}

export function getMachinesByNamespace(db: Database, namespace: string): StoredMachine[] {
    const rows = db.prepare(
        'SELECT * FROM machines WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbMachineRow[]
    return rows.map(toStoredMachine)
}
