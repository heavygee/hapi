import { z } from 'zod'

export const ProvenanceIssueCodeSchema = z.enum([
    'active_unproven',
    'archived_but_active',
    'machine_no_spawn_rpc',
    'machine_no_runner_proof',
    'machine_capability_skew',
    'machine_cli_stale',
])

export type ProvenanceIssueCode = z.infer<typeof ProvenanceIssueCodeSchema>

export const SessionProvenanceRowSchema = z.object({
    sessionId: z.string(),
    name: z.string().nullable(),
    active: z.boolean(),
    lifecycleState: z.string().nullable(),
    machineId: z.string().nullable(),
    hostPid: z.number().nullable(),
    flavor: z.string().nullable(),
    hasKillSessionRpc: z.boolean(),
    issues: z.array(ProvenanceIssueCodeSchema),
})

export type SessionProvenanceRow = z.infer<typeof SessionProvenanceRowSchema>

export const MachineProvenanceRowSchema = z.object({
    machineId: z.string(),
    displayName: z.string().nullable(),
    host: z.string().nullable(),
    active: z.boolean(),
    hasSpawnRpc: z.boolean(),
    hasRunnerProof: z.boolean(),
    capabilitySkew: z.boolean(),
    cliBinaryStale: z.boolean(),
    happyCliVersion: z.string().nullable(),
    issues: z.array(ProvenanceIssueCodeSchema),
})

export type MachineProvenanceRow = z.infer<typeof MachineProvenanceRowSchema>

export const UnverifiedPeerMessageRowSchema = z.object({
    messageId: z.string(),
    sessionId: z.string(),
    sessionName: z.string().nullable(),
    seq: z.number(),
    createdAt: z.number(),
    textPreview: z.string(),
    /** Client prose From: line in body — not hub-trusted. */
    claimedPeerHeaderInText: z.boolean(),
})

export type UnverifiedPeerMessageRow = z.infer<typeof UnverifiedPeerMessageRowSchema>

export const ProvenanceMessageScanMetaSchema = z.object({
    sinceMs: z.number(),
    limit: z.number(),
    maxScan: z.number(),
    messagesScanned: z.number(),
    /** Unverified peer rows found in the scanned window (may exceed returned rows). */
    unverifiedTotal: z.number(),
    /** True when scan hit maxScan before exhausting the time window. */
    scanTruncated: z.boolean(),
})

export type ProvenanceMessageScanMeta = z.infer<typeof ProvenanceMessageScanMetaSchema>

export const ProvenanceDiagnosticsSchema = z.object({
    generatedAt: z.number(),
    sessions: z.array(SessionProvenanceRowSchema),
    machines: z.array(MachineProvenanceRowSchema),
    unverifiedPeerMessages: z.array(UnverifiedPeerMessageRowSchema),
    messageScan: ProvenanceMessageScanMetaSchema.nullable(),
    summary: z.object({
        activeSessions: z.number(),
        unprovenActiveSessions: z.number(),
        archivedButActiveSessions: z.number(),
        onlineMachines: z.number(),
        machinesWithIssues: z.number(),
        unverifiedPeerMessages: z.number(),
    }),
})

export type ProvenanceDiagnostics = z.infer<typeof ProvenanceDiagnosticsSchema>
