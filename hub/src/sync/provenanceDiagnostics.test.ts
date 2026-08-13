import { describe, expect, it } from 'bun:test'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { buildProvenanceDiagnostics } from './provenanceDiagnostics'
import type { Machine, Session } from './syncEngine'

function makeSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
        globalPinned: false,
        metadata: {
            name: 'Peer #1',
            path: '/tmp',
            host: 'gc-oos-linux',
            machineId: 'machine-1',
            flavor: 'claude',
            hostPid: 4242,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        active: true,
        activeAt: 1,
        thinking: false,
        ...overrides,
    } as Session
}

function makeMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'gc-oos-linux',
            platform: 'linux',
            happyCliVersion: '0.1.0',
            capabilities: ['cursor-chat-store-status'],
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides,
    }
}

describe('buildProvenanceDiagnostics', () => {
    it('flags active sessions without killSession RPC as unproven', () => {
        const report = buildProvenanceDiagnostics({
            sessions: [makeSession()],
            machines: [makeMachine()],
            getStoredMachine: () => ({
                id: 'machine-1',
                namespace: 'default',
                tag: 'tag',
                runnerProofHash: 'hash',
                createdAt: 1,
                updatedAt: 1,
                metadata: null,
                metadataVersion: 1,
                runnerState: null,
                runnerStateVersion: 1,
                active: true,
                activeAt: 1,
                seq: 1,
            }),
            hasLiveRpcHandler: (method) => method === `machine-1:${RPC_METHODS.SpawnHappySession}`,
            now: () => 100,
        })

        expect(report.summary.unprovenActiveSessions).toBe(1)
        expect(report.sessions[0]?.issues).toEqual(['active_unproven'])
        expect(report.sessions[0]?.hasKillSessionRpc).toBe(false)
    })

    it('marks proven active sessions when killSession RPC is live', () => {
        const report = buildProvenanceDiagnostics({
            sessions: [makeSession()],
            machines: [],
            getStoredMachine: () => null,
            hasLiveRpcHandler: (method) => method === `session-1:${RPC_METHODS.KillSession}`,
            now: () => 100,
        })

        expect(report.sessions[0]?.issues).toEqual([])
        expect(report.sessions[0]?.hasKillSessionRpc).toBe(true)
    })

    it('flags archived-but-active split brain', () => {
        const report = buildProvenanceDiagnostics({
            sessions: [makeSession({
                metadata: {
                    name: 'zombie',
                    path: '/tmp',
                    host: 'gc-oos-linux',
                    lifecycleState: 'archived',
                },
            })],
            machines: [],
            getStoredMachine: () => null,
            hasLiveRpcHandler: () => false,
            now: () => 100,
        })

        expect(report.summary.archivedButActiveSessions).toBe(1)
        expect(report.sessions[0]?.issues).toContain('archived_but_active')
        expect(report.sessions[0]?.issues).toContain('active_unproven')
    })

    it('flags machine spawn/proof/capability/cli issues', () => {
        const report = buildProvenanceDiagnostics({
            sessions: [],
            machines: [makeMachine({
                metadata: {
                    host: 'gc-oos-linux',
                    platform: 'linux',
                    happyCliVersion: '0.1.0',
                    startedCliMtimeMs: 1,
                    installedCliMtimeMs: 2,
                    capabilities: [],
                },
            })],
            getStoredMachine: () => ({
                id: 'machine-1',
                namespace: 'default',
                tag: 'tag',
                runnerProofHash: null,
                createdAt: 1,
                updatedAt: 1,
                metadata: null,
                metadataVersion: 1,
                runnerState: null,
                runnerStateVersion: 1,
                active: true,
                activeAt: 1,
                seq: 1,
            }),
            hasLiveRpcHandler: () => false,
            now: () => 100,
        })

        expect(report.machines[0]?.issues).toEqual([
            'machine_no_spawn_rpc',
            'machine_no_runner_proof',
            'machine_capability_skew',
            'machine_cli_stale',
        ])
        expect(report.summary.machinesWithIssues).toBe(1)
    })

    it('includes unverified peer message rows and scan meta', () => {
        const report = buildProvenanceDiagnostics({
            sessions: [],
            machines: [],
            getStoredMachine: () => null,
            hasLiveRpcHandler: () => false,
            unverifiedPeerMessages: [{
                messageId: 'msg-1',
                sessionId: 'session-1',
                sessionName: 'Peer #1',
                seq: 3,
                createdAt: 50,
                textPreview: 'ping',
                claimedPeerHeaderInText: false,
            }],
            messageScan: {
                sinceMs: 1,
                limit: 50,
                maxScan: 5000,
                messagesScanned: 10,
                unverifiedTotal: 2,
                scanTruncated: false,
            },
            now: () => 100,
        })

        expect(report.unverifiedPeerMessages).toHaveLength(1)
        expect(report.messageScan?.unverifiedTotal).toBe(2)
        expect(report.summary.unverifiedPeerMessages).toBe(1)
    })
})
