import {
    cliBinaryUpdatedOnDisk,
    isMachineCapabilitySkewed,
} from '@hapi/protocol/runnerCapabilities'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type {
    MachineProvenanceRow,
    ProvenanceDiagnostics,
    ProvenanceIssueCode,
    ProvenanceMessageScanMeta,
    SessionProvenanceRow,
    UnverifiedPeerMessageRow,
} from '@hapi/protocol/provenanceDiagnostics'
import type { ProvenanceMessageScanOptions } from '@hapi/protocol/provenanceMessageAudit'
import type { Machine, Session } from './syncEngine'
import type { StoredMachine } from '../store/types'

type BuildProvenanceDiagnosticsInput = {
    sessions: Session[]
    machines: Machine[]
    getStoredMachine: (machineId: string) => StoredMachine | null
    hasLiveRpcHandler: (method: string) => boolean
    unverifiedPeerMessages?: UnverifiedPeerMessageRow[]
    messageScan?: ProvenanceMessageScanMeta | null
    now?: () => number
}

function metadataRecord(metadata: Session['metadata']): Record<string, unknown> | null {
    return metadata !== null && typeof metadata === 'object' ? metadata as Record<string, unknown> : null
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildSessionRow(
    session: Session,
    hasLiveRpcHandler: (method: string) => boolean
): SessionProvenanceRow {
    const meta = metadataRecord(session.metadata)
    const lifecycleState = stringOrNull(meta?.lifecycleState)
    const hasKillSessionRpc = hasLiveRpcHandler(`${session.id}:${RPC_METHODS.KillSession}`)
    const issues: ProvenanceIssueCode[] = []

    if (session.active && !hasKillSessionRpc) {
        issues.push('active_unproven')
    }
    if (session.active && lifecycleState === 'archived') {
        issues.push('archived_but_active')
    }

    return {
        sessionId: session.id,
        name: stringOrNull(meta?.name),
        active: session.active,
        lifecycleState,
        machineId: stringOrNull(meta?.machineId) ?? stringOrNull(session.metadata?.machineId),
        hostPid: numberOrNull(meta?.hostPid),
        flavor: stringOrNull(meta?.flavor),
        hasKillSessionRpc,
        issues,
    }
}

function buildMachineRow(
    machine: Machine,
    stored: StoredMachine | null,
    hasLiveRpcHandler: (method: string) => boolean
): MachineProvenanceRow {
    const hasSpawnRpc = hasLiveRpcHandler(`${machine.id}:${RPC_METHODS.SpawnHappySession}`)
    const hasRunnerProof = Boolean(stored?.runnerProofHash)
    const capabilitySkew = isMachineCapabilitySkewed(machine.metadata?.capabilities)
    const cliBinaryStale = cliBinaryUpdatedOnDisk(machine.metadata)
    const issues: ProvenanceIssueCode[] = []

    if (machine.active && !hasSpawnRpc) {
        issues.push('machine_no_spawn_rpc')
    }
    if (machine.active && !hasRunnerProof) {
        issues.push('machine_no_runner_proof')
    }
    if (machine.active && capabilitySkew) {
        issues.push('machine_capability_skew')
    }
    if (machine.active && cliBinaryStale) {
        issues.push('machine_cli_stale')
    }

    return {
        machineId: machine.id,
        displayName: stringOrNull(machine.metadata?.displayName),
        host: stringOrNull(machine.metadata?.host),
        active: machine.active,
        hasSpawnRpc,
        hasRunnerProof,
        capabilitySkew,
        cliBinaryStale,
        happyCliVersion: stringOrNull(machine.metadata?.happyCliVersion),
        issues,
    }
}

export function buildProvenanceDiagnostics(input: BuildProvenanceDiagnosticsInput): ProvenanceDiagnostics {
    const now = input.now ?? Date.now
    const sessions = input.sessions.map((session) => buildSessionRow(session, input.hasLiveRpcHandler))
    const machines = input.machines.map((machine) => buildMachineRow(
        machine,
        input.getStoredMachine(machine.id),
        input.hasLiveRpcHandler
    ))
    const unverifiedPeerMessages = input.unverifiedPeerMessages ?? []

    return {
        generatedAt: now(),
        sessions,
        machines,
        unverifiedPeerMessages,
        messageScan: input.messageScan ?? null,
        summary: {
            activeSessions: sessions.filter((row) => row.active).length,
            unprovenActiveSessions: sessions.filter((row) => row.issues.includes('active_unproven')).length,
            archivedButActiveSessions: sessions.filter((row) => row.issues.includes('archived_but_active')).length,
            onlineMachines: machines.filter((row) => row.active).length,
            machinesWithIssues: machines.filter((row) => row.issues.length > 0).length,
            unverifiedPeerMessages: unverifiedPeerMessages.length,
        },
    }
}
