import { describe, expect, it } from 'vitest'
import {
    formatProvenanceReport,
    parseDoctorProvenanceArgs,
    provenanceDiagnosticsHasIssues,
    provenanceDiagnosticsHasUnverifiedMessages,
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
    unverifiedPeerMessages: [],
    messageScan: null,
    summary: {
        activeSessions: 1,
        unprovenActiveSessions: 0,
        archivedButActiveSessions: 0,
        onlineMachines: 1,
        machinesWithIssues: 0,
        unverifiedPeerMessages: 0,
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

    it('formatProvenanceReport lists unverified peer messages when scan meta present', () => {
        const report = formatProvenanceReport({
            ...cleanDiagnostics,
            unverifiedPeerMessages: [{
                messageId: 'msg-1',
                sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                sessionName: 'Peer #1',
                seq: 2,
                createdAt: 50,
                textPreview: 'unverified ping',
                claimedPeerHeaderInText: true,
            }],
            messageScan: {
                sinceMs: 1,
                limit: 50,
                maxScan: 5000,
                messagesScanned: 100,
                unverifiedTotal: 1,
                scanTruncated: false,
            },
            summary: {
                ...cleanDiagnostics.summary,
                unverifiedPeerMessages: 1,
            },
        })
        expect(report).toContain('Unverified peer messages')
        expect(report).toContain('unverified ping')
        expect(report).toContain('prose-From:')
    })

    it('parseDoctorProvenanceArgs maps CLI flags', () => {
        expect(parseDoctorProvenanceArgs(['--no-messages', '--strict-messages', '--since-days', '3', '--message-limit', '10'])).toEqual({
            skipMessages: true,
            strictMessages: true,
            sinceDays: 3,
            messageLimit: 10,
        })
    })

    it('provenanceDiagnosticsHasUnverifiedMessages uses scan total', () => {
        expect(provenanceDiagnosticsHasUnverifiedMessages({
            ...cleanDiagnostics,
            messageScan: {
                sinceMs: 1,
                limit: 50,
                maxScan: 5000,
                messagesScanned: 1,
                unverifiedTotal: 0,
                scanTruncated: false,
            },
        })).toBe(false)
        expect(provenanceDiagnosticsHasUnverifiedMessages({
            ...cleanDiagnostics,
            messageScan: {
                sinceMs: 1,
                limit: 50,
                maxScan: 5000,
                messagesScanned: 1,
                unverifiedTotal: 3,
                scanTruncated: false,
            },
        })).toBe(true)
    })
})
