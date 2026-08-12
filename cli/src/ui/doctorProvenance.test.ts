import { describe, expect, it } from 'vitest'
import {
    formatProvenanceReport,
    provenanceDiagnosticsHasIssues,
} from './doctorProvenance'
import type { ProvenanceDiagnostics } from '@hapi/protocol/provenanceDiagnostics'

const cleanDiagnostics: ProvenanceDiagnostics = {
    generatedAt: 100,
    sessions: [{
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        name: 'Peer #1',
        active: true,
        lifecycleState: null,
        machineId: 'machine-1',
        hostPid: 42,
        flavor: 'claude',
        hasKillSessionRpc: true,
        issues: [],
    }],
    machines: [{
        machineId: 'machine-1',
        displayName: 'gc-oos-linux',
        host: 'gc-oos-linux',
        active: true,
        hasSpawnRpc: true,
        hasRunnerProof: true,
        capabilitySkew: false,
        cliBinaryStale: false,
        happyCliVersion: '0.1.0',
        issues: [],
    }],
    summary: {
        activeSessions: 1,
        unprovenActiveSessions: 0,
        archivedButActiveSessions: 0,
        onlineMachines: 1,
        machinesWithIssues: 0,
    },
}

describe('doctorProvenance', () => {
    it('formatProvenanceReport includes session and machine rows', () => {
        const report = formatProvenanceReport(cleanDiagnostics)
        expect(report).toContain('Peer #1')
        expect(report).toContain('gc-oos-linux')
        expect(report).toContain('active sessions: 1')
    })

    it('provenanceDiagnosticsHasIssues is false when all rows are clean', () => {
        expect(provenanceDiagnosticsHasIssues(cleanDiagnostics)).toBe(false)
    })

    it('provenanceDiagnosticsHasIssues is true for unproven active sessions', () => {
        expect(provenanceDiagnosticsHasIssues({
            ...cleanDiagnostics,
            sessions: [{
                ...cleanDiagnostics.sessions[0]!,
                hasKillSessionRpc: false,
                issues: ['active_unproven'],
            }],
            summary: {
                ...cleanDiagnostics.summary,
                unprovenActiveSessions: 1,
            },
        })).toBe(true)
    })
})
