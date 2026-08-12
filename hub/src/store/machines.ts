import type { Database } from 'bun:sqlite'
import {
    machineRegistrationNeedsRefresh,
    mergeMachineRegistrationMetadata,
} from '@hapi/protocol/machineRegistration'

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

function terminalBootstrapWouldMaskRunner(stored: unknown, incoming: unknown): boolean {
    const current = isPlainObject(stored) ? stored : null
    const next = isPlainObject(incoming) ? incoming : null
    if (!current || !next) {
        return false
    }
    const runnerKeys = [
        'happyCliVersion',
        'capabilities',
        'cliArtifactGeneration',
        'versionHandoffDisabled',
        'supervisedRestart',
        'startedCliMtimeMs',
        'installedCliMtimeMs',
    ] as const
    for (const key of runnerKeys) {
        if (next[key] !== undefined && JSON.stringify(next[key]) !== JSON.stringify(current[key])) {
            return true
        }
    }
    return false
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
        // Run BEFORE the non-runner early return so enrollment conflicts still fire
        // when terminal/bootstrap paths pass runnerState=null.
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
        //
        // Cold proof rebind (#1473 merge gate): when create-time machineTag matches,
        // accept a new memory-only proof and replace the hash in place. Keeps
        // machineId stable so Cursor/Pi exact-id resume survives runner restart
        // without SQL remap. Do not gate on DB active/activeAt — heartbeats only
        // refresh the in-memory cache, so sticky active=1 would force rotate on
        // fast stop/start. Live runners present the matching proof and never hit
        // this branch; tag-theft rebind is accepted under best-effort provenance.
        if (current.runnerProofHash) {
            if (!presentedProof || !verifyRunnerProof(presentedProof, current.runnerProofHash)) {
                const tagOk = Boolean(
                    presentedTag
                    && current.tag
                    && constantTimeEquals(current.tag, presentedTag)
                )
                if (presentedProof && tagOk) {
                    const now = Date.now()
                    db.prepare(`
                        UPDATE machines
                        SET runner_proof_hash = @runner_proof_hash,
                            updated_at = @updated_at,
                            seq = seq + 1
                        WHERE id = @id
                    `).run({
                        runner_proof_hash: hashRunnerProof(presentedProof),
                        updated_at: now,
                        id,
                    })
                    const rebound = getMachine(db, id)
                    if (!rebound) {
                        throw new Error('Failed to rebind machine runner proof')
                    }
                    current = rebound
                    // Tip path refreshes metadata after rebind; soup's non-runner
                    // early return would otherwise leave stale host/version fields
                    // (#1473 cold-rebind soup union).
                    const reboundMerged = mergeMachineMetadata(current.metadata, metadata)
                    if (reboundMerged !== undefined) {
                        db.prepare(`
                            UPDATE machines
                            SET metadata = @metadata,
                                metadata_version = metadata_version + 1,
                                updated_at = @updated_at,
                                seq = seq + 1
                            WHERE id = @id
                        `).run({
                            metadata: JSON.stringify(reboundMerged),
                            updated_at: Date.now(),
                            id,
                        })
                        const row = getMachine(db, id)
                        if (!row) {
                            throw new Error('Failed to refresh machine metadata after proof rebind')
                        }
                        current = row
                    }
                } else {
                    throw new MachineTagConflictError(
                        'Machine runner proof mismatch; re-enroll with a new machine id'
                    )
                }
            }
        } else if (presentedProof) {
            throw new MachineTagConflictError(
                'Machine runner proof missing; re-enroll with a new machine id'
            )
        }

        // Identity refresh is runner-registration only. Terminal session
        // bootstrap hits the same machine id with runnerState=null and current
        // CLI metadata — refreshing there would mask a still-old live runner
        // (banner/auto-upgrade disappear while the runner socket is stale).
        const isRunnerRegistration = runnerState !== null && runnerState !== undefined
        if (!isRunnerRegistration) {
            if (terminalBootstrapWouldMaskRunner(current.metadata, metadata)) {
                return current
            }
            const merged = mergeMachineMetadata(current.metadata, metadata)
            if (merged === undefined) {
                return current
            }
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
            return row
        }

        // Re-registering runners used to keep stale hub metadata forever
        // (version/capabilities from the first connect). Refresh identity when
        // the client sends newer registration fields.
        if (machineRegistrationNeedsRefresh(stored.metadata, metadata)) {
            const identityMerged = mergeMachineRegistrationMetadata(stored.metadata, metadata)
            // Identity merge starts from incoming but keeps capabilities: [].
            // Runner re-register must omit ads entirely (#1108 sticky supervisedRestart).
            const mergedIdentity = mergeMachineMetadata(identityMerged, metadata, {
                clearOmittedRunnerAds: true,
            }) ?? identityMerged
            const result = updateMachineMetadata(
                db,
                id,
                mergedIdentity,
                stored.metadataVersion,
                namespace,
            )
            if (result.result === 'success') {
                const refreshed = getMachine(db, id)
                if (refreshed) {
                    current = refreshed
                }
            } else {
                // Version conflict or race: fall through to current row; connect
                // path can still push identity via machine-update-metadata.
                current = getMachine(db, id) ?? stored
            }
            // Still merge runner capabilities on the identity-refresh path —
            // metadata + capability upgrades often arrive in the same register.
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
        // General merge: fill missing machine-owned fields (e.g. arch)
        // that are not covered by the identity refresh predicate above.
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
