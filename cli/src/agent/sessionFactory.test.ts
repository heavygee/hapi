import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/api/types'

const {
    getSessionMock,
    getOrCreateSessionMock,
    getOrCreateMachineMock,
    getMachineMock,
    sessionSyncClientMock,
    notifyRunnerSessionStartedMock,
    readSettingsMock,
    readRunnerStateMock,
    isProcessAliveMock,
    spawnHappyCLIMock,
    getHapiRunnerProcessIdentityMock
} = vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getOrCreateSessionMock: vi.fn(),
    getOrCreateMachineMock: vi.fn(),
    getMachineMock: vi.fn(async (_id?: string): Promise<{ id: string } | null> => null),
    sessionSyncClientMock: vi.fn(),
    notifyRunnerSessionStartedMock: vi.fn(async () => ({})),
    readSettingsMock: vi.fn(),
    readRunnerStateMock: vi.fn(async (): Promise<{ pid: number; hubReadyAt?: number; startTime?: string } | null> => ({ pid: 4242, hubReadyAt: 1 })),
    isProcessAliveMock: vi.fn(() => true),
    spawnHappyCLIMock: vi.fn(() => ({ unref: vi.fn(), on: vi.fn(), pid: 1 })),
    getHapiRunnerProcessIdentityMock: vi.fn((): 'runner' | 'foreign' | 'unknown' | 'dead' => 'runner')
}))

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: async () => ({
            getSession: getSessionMock,
            getOrCreateSession: getOrCreateSessionMock,
            getOrCreateMachine: getOrCreateMachineMock,
            getMachine: getMachineMock,
            sessionSyncClient: sessionSyncClientMock
        })
    }
}))

vi.mock('@/runner/controlClient', () => ({
    notifyRunnerSessionStarted: notifyRunnerSessionStartedMock,
    getInstalledCliMtimeMs: () => 1_700_000_000_000,
}))

vi.mock('@/persistence', () => ({
    readSettings: readSettingsMock,
    readRunnerState: readRunnerStateMock
}))

vi.mock('@/utils/process', () => ({
    isProcessAlive: isProcessAliveMock,
    getHapiRunnerProcessIdentity: getHapiRunnerProcessIdentityMock
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
    spawnHappyCLI: spawnHappyCLIMock
}))

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/.hapi',
        logsDir: '/tmp/.hapi/logs',
        isRunnerProcess: false
    }
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}))

import {
    HAPI_SESSION_ID_ENV,
    bootstrapExistingSession,
    bootstrapLazySession,
    resetRunnerStartForTests,
    bootstrapSession,
    buildMachineMetadata,
    buildSessionMetadata
} from './sessionFactory'

function createSession(): Session {
    return {
        id: 'hapi-session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            machineId: 'machine-1',
            flavor: 'codex',
            codexSessionId: 'codex-thread-1'
        },
        metadataVersion: 1,
        agentState: { controlledByUser: false },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        todos: [],
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        permissionMode: undefined,
        collaborationMode: undefined
    }
}

describe('bootstrapExistingSession', () => {
    beforeEach(() => {
        getSessionMock.mockReset()
        getOrCreateSessionMock.mockReset()
        getOrCreateMachineMock.mockReset()
        getMachineMock.mockReset()
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReset()
        notifyRunnerSessionStartedMock.mockClear()
        readSettingsMock.mockReset()
        readRunnerStateMock.mockReset()
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 1 })
        isProcessAliveMock.mockReset()
        isProcessAliveMock.mockReturnValue(true)
        spawnHappyCLIMock.mockClear()
        resetRunnerStartForTests()
        getHapiRunnerProcessIdentityMock.mockReset()
        getHapiRunnerProcessIdentityMock.mockReturnValue('runner')
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('loads an existing HAPI session and reports it to the runner', async () => {
        const session = createSession()
        const sessionClient = {
            updateMetadata: vi.fn()
        }
        getSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue(sessionClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapExistingSession({
            sessionId: 'hapi-session-1',
            flavor: 'codex',
            workingDirectory: '/tmp/project'
        })

        expect(result.sessionInfo.id).toBe('hapi-session-1')
        expect(process.env[HAPI_SESSION_ID_ENV]).toBe('hapi-session-1')
        expect(result.workingDirectory).toBe('/tmp/project')
        expect(sessionSyncClientMock).toHaveBeenCalledWith(session)
        expect(sessionClient.updateMetadata).toHaveBeenCalledOnce()
        expect(notifyRunnerSessionStartedMock).toHaveBeenCalledWith(
            'hapi-session-1',
            expect.objectContaining({
                path: '/tmp/project',
                flavor: 'codex',
                startedBy: 'terminal',
                startedFromRunner: false,
                machineId: 'machine-1'
            })
        )
    })

    it('refuses to reopen a hub-archived session (hub-archive resurrection guard)', async () => {
        // #1911 M1 belt: hub-archived only (matches store merge-preserve scope).
        const session = createSession()
        const existing = session.metadata
        if (!existing) throw new Error('expected metadata')
        session.metadata = {
            ...existing,
            lifecycleState: 'archived',
            archivedBy: 'hub',
            archiveReason: 'Archived from hub',
        }
        const sessionClient = { updateMetadata: vi.fn() }
        getSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue(sessionClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        await expect(bootstrapExistingSession({
            sessionId: 'hapi-session-1',
            flavor: 'claude',
            workingDirectory: '/tmp/project',
            startedBy: 'runner',
        })).rejects.toThrow(/hub-archived|archived/)

        expect(sessionClient.updateMetadata).not.toHaveBeenCalled()
        expect(notifyRunnerSessionStartedMock).not.toHaveBeenCalled()
        expect(sessionSyncClientMock).not.toHaveBeenCalled()
    })

    it('allows reopen of CLI self-archived sessions (archivedBy=cli)', async () => {
        const session = createSession()
        const existing = session.metadata
        if (!existing) throw new Error('expected metadata')
        session.metadata = {
            ...existing,
            lifecycleState: 'archived',
            archivedBy: 'cli',
            archiveReason: 'clean exit',
        }
        const sessionClient = { updateMetadata: vi.fn() }
        getSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue(sessionClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        await expect(bootstrapExistingSession({
            sessionId: 'hapi-session-1',
            flavor: 'claude',
            workingDirectory: '/tmp/project',
            startedBy: 'runner',
        })).resolves.toMatchObject({ session: sessionClient })

        expect(sessionClient.updateMetadata).toHaveBeenCalledOnce()
    })

    it('preserves existing native resume metadata when reactivating a session', async () => {
        const session = createSession()
        const existingMetadata = session.metadata
        if (!existingMetadata) throw new Error('expected test session metadata')

        session.metadata = {
            ...existingMetadata,
            claudeSessionId: 'claude-thread-1',
            codexSessionId: 'codex-thread-1',
            codexUsage: {
                contextWindow: {
                    usedTokens: 1200,
                    limitTokens: 128000,
                    percent: 1,
                    updatedAt: 456
                },
                rateLimits: {}
            },
            geminiSessionId: 'gemini-thread-1',
            opencodeSessionId: 'opencode-thread-1',
            grokSessionId: 'grok-thread-1',
            cursorSessionId: 'cursor-thread-1',
            cursorSessionProtocol: 'acp',
            piSessionId: 'pi-thread-1',
            piResumeAttempt: {
                state: 'resuming',
                machineId: 'machine-1',
                startedAt: 123,
            },
            ptyResumeAttempt: {
                state: 'quarantined',
                machineId: 'machine-1',
                startedAt: 456,
            },
            summary: {
                text: 'resume me',
                updatedAt: 100
            },
            tools: ['read_file'],
            slashCommands: ['/compact'],
            conversationHistoryPoints: { 'local-user-1': true },
            conversationHistoryEntryIds: { 'local-user-1': 'pi-entry-1' },
            capabilities: {
                terminal: true,
                conversationHistory: { forkCurrent: true }
            }
        }
        const sessionClient = {
            updateMetadata: vi.fn()
        }
        getSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue(sessionClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapExistingSession({
            sessionId: 'hapi-session-1',
            flavor: 'codex',
            workingDirectory: '/tmp/project'
        })

        expect(result.metadata).toEqual(expect.objectContaining({
            claudeSessionId: 'claude-thread-1',
            codexSessionId: 'codex-thread-1',
            codexUsage: {
                contextWindow: {
                    usedTokens: 1200,
                    limitTokens: 128000,
                    percent: 1,
                    updatedAt: 456
                },
                rateLimits: {}
            },
            geminiSessionId: 'gemini-thread-1',
            opencodeSessionId: 'opencode-thread-1',
            grokSessionId: 'grok-thread-1',
            cursorSessionId: 'cursor-thread-1',
            cursorSessionProtocol: 'acp',
            piSessionId: 'pi-thread-1',
            piResumeAttempt: {
                state: 'resuming',
                machineId: 'machine-1',
                startedAt: 123,
            },
            ptyResumeAttempt: {
                state: 'quarantined',
                machineId: 'machine-1',
                startedAt: 456,
            },
            summary: {
                text: 'resume me',
                updatedAt: 100
            },
            tools: ['read_file'],
            slashCommands: ['/compact'],
            conversationHistoryPoints: { 'local-user-1': true },
            conversationHistoryEntryIds: { 'local-user-1': 'pi-entry-1' },
            capabilities: {
                terminal: true,
                conversationHistory: { forkCurrent: true }
            }
        }))
        expect(sessionClient.updateMetadata).toHaveBeenCalledOnce()
        const updateHandler = sessionClient.updateMetadata.mock.calls[0][0]
        expect(updateHandler(session.metadata)).toEqual(expect.objectContaining({
            codexSessionId: 'codex-thread-1',
            codexUsage: {
                contextWindow: {
                    usedTokens: 1200,
                    limitTokens: 128000,
                    percent: 1,
                    updatedAt: 456
                },
                rateLimits: {}
            },
            grokSessionId: 'grok-thread-1',
            conversationHistoryEntryIds: { 'local-user-1': 'pi-entry-1' }
        }))
        expect(notifyRunnerSessionStartedMock).toHaveBeenCalledWith(
            'hapi-session-1',
            expect.objectContaining({
                codexSessionId: 'codex-thread-1',
                codexUsage: {
                    contextWindow: {
                        usedTokens: 1200,
                        limitTokens: 128000,
                        percent: 1,
                        updatedAt: 456
                    },
                    rateLimits: {}
                },
                grokSessionId: 'grok-thread-1',
                conversationHistoryEntryIds: { 'local-user-1': 'pi-entry-1' }
            })
        )
    })

    it('advertises remote terminal capability in session metadata', () => {
        const metadata = buildSessionMetadata({
            flavor: 'codex',
            startedBy: 'terminal',
            workingDirectory: '/tmp/project',
            machineId: 'machine-1',
            now: 123
        })

        expect(metadata.capabilities?.terminal).toBe(true)
    })
})

describe('bootstrapLazySession', () => {
    beforeEach(() => {
        getOrCreateSessionMock.mockReset()
        getOrCreateMachineMock.mockReset()
        getMachineMock.mockReset()
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReset()
        notifyRunnerSessionStartedMock.mockClear()
        readSettingsMock.mockReset()
        readRunnerStateMock.mockReset()
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 1 })
        isProcessAliveMock.mockReset()
        isProcessAliveMock.mockReturnValue(true)
        spawnHappyCLIMock.mockClear()
        resetRunnerStartForTests()
        getHapiRunnerProcessIdentityMock.mockReset()
        getHapiRunnerProcessIdentityMock.mockReturnValue('runner')
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('does not export HAPI_SESSION_ID until the hub row is materialized', async () => {
        const pendingClient = { isPending: () => true }
        sessionSyncClientMock.mockReturnValue(pendingClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapLazySession({
            flavor: 'codex',
            startedBy: 'terminal',
            workingDirectory: '/tmp/project',
            agentState: { controlledByUser: false }
        })

        expect(process.env[HAPI_SESSION_ID_ENV]).toBeUndefined()
        expect(result.sessionInfo.id).toMatch(/^[0-9a-f-]{36}$/)

        const [, options] = sessionSyncClientMock.mock.calls[0]
        const materialized = createSession()
        materialized.id = result.sessionInfo.id
        options.onMaterialized(materialized, {
            metadata: result.metadata,
            agentState: { controlledByUser: false }
        })

        expect(process.env[HAPI_SESSION_ID_ENV]).toBe(result.sessionInfo.id)
    })

    it('does not persist a machine or session until materialization', async () => {
        const pendingClient = { isPending: () => true }
        sessionSyncClientMock.mockReturnValue(pendingClient)
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapLazySession({
            flavor: 'codex',
            startedBy: 'terminal',
            workingDirectory: '/tmp/project',
            agentState: { controlledByUser: false }
        })

        expect(result.session).toBe(pendingClient)
        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
        expect(getOrCreateSessionMock).not.toHaveBeenCalled()
        expect(notifyRunnerSessionStartedMock).not.toHaveBeenCalled()

        const [provisional, options] = sessionSyncClientMock.mock.calls[0]
        expect(provisional.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(provisional.metadata).toEqual(expect.objectContaining({
            machineId: 'machine-1',
            path: '/tmp/project',
            flavor: 'codex'
        }))

        const materialized = createSession()
        materialized.id = provisional.id
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        getOrCreateSessionMock.mockResolvedValue(materialized)
        const snapshot = {
            metadata: {
                ...provisional.metadata,
                codexSessionId: 'codex-thread-1'
            },
            agentState: { controlledByUser: true }
        }
        await options.materialize(snapshot, new AbortController().signal)

        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
        expect(getOrCreateSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            id: provisional.id,
            metadata: snapshot.metadata,
            state: snapshot.agentState,
            timeoutMs: 10_000,
        }))
        expect(getOrCreateSessionMock.mock.calls[0][0].machine).toBeUndefined()

        options.onMaterialized(materialized, snapshot)
        expect(notifyRunnerSessionStartedMock).toHaveBeenCalledWith(
            provisional.id,
            expect.objectContaining({ codexSessionId: 'codex-thread-1' })
        )
    })

    it('aborts the machine wait when materialize is cancelled', async () => {
        sessionSyncClientMock.mockReturnValue({ isPending: () => true })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 0 })
        getMachineMock.mockResolvedValue(null)

        await bootstrapLazySession({
            flavor: 'codex',
            workingDirectory: '/tmp/project'
        })
        const [, options] = sessionSyncClientMock.mock.calls[0]
        const controller = new AbortController()
        controller.abort()
        await expect(options.materialize({
            metadata: { machineId: 'machine-1' },
            agentState: {}
        }, controller.signal)).rejects.toThrow(/abort/i)
        expect(getOrCreateSessionMock).not.toHaveBeenCalled()
    })
})

describe('bootstrapSession HAPI_SESSION_ID export', () => {
    beforeEach(() => {
        getOrCreateSessionMock.mockReset()
        getOrCreateMachineMock.mockReset()
        getMachineMock.mockReset()
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReset()
        notifyRunnerSessionStartedMock.mockClear()
        readSettingsMock.mockReset()
        readRunnerStateMock.mockReset()
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 1 })
        isProcessAliveMock.mockReset()
        isProcessAliveMock.mockReturnValue(true)
        spawnHappyCLIMock.mockClear()
        resetRunnerStartForTests()
        getHapiRunnerProcessIdentityMock.mockReset()
        getHapiRunnerProcessIdentityMock.mockReturnValue('runner')
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('exports the hub session id so spawned agents inherit it', async () => {
        const session = createSession()
        session.id = 'hub-session-42'
        getOrCreateSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(result.sessionInfo.id).toBe('hub-session-42')
        expect(process.env[HAPI_SESSION_ID_ENV]).toBe('hub-session-42')
    })

    it('references an existing hub machine without re-registering (#2038)', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1', machineTag: 'secret-tag' })

        await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(getMachineMock).toHaveBeenCalledWith('machine-1')
        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
    })

    it('skips machine registration when the hub row already exists', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1', machineTag: 'secret-tag' })

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
        expect(result.machineId).toBe('machine-1')
    })

    it('uses an existing machine row when the runner is not running', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1', machineTag: 'secret-tag' })
        readRunnerStateMock.mockResolvedValue(null)
        isProcessAliveMock.mockReturnValue(false)

        const result = await bootstrapSession({
            flavor: 'cursor',
            workingDirectory: '/tmp/project'
        })

        expect(result.machineId).toBe('machine-1')
        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
        expect(getMachineMock).toHaveBeenCalledWith('machine-1')
    })

    it('does not create a proof-less machine when the hub row is missing', async () => {
        getMachineMock.mockResolvedValue(null)
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1', machineTag: 'secret-tag' })
        readRunnerStateMock.mockResolvedValue(null)
        isProcessAliveMock.mockReturnValue(false)

        await expect(bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })).rejects.toThrow(/not registered on the hub/)
        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
        expect(spawnHappyCLIMock).toHaveBeenCalledWith(['runner', 'start-sync'], expect.objectContaining({
            detached: true,
        }))
    })

    it('starts a runner when the state pid is not a hapi process', async () => {
        getMachineMock.mockResolvedValue(null)
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
        readRunnerStateMock.mockResolvedValue({
            pid: 4242,
            startTime: new Date().toISOString(),
        })
        isProcessAliveMock.mockReturnValue(true)
        getHapiRunnerProcessIdentityMock.mockReturnValue('foreign')

        await expect(bootstrapSession({
            flavor: 'cursor',
            workingDirectory: '/tmp/project'
        })).rejects.toThrow(/not registered on the hub/)
        expect(spawnHappyCLIMock).toHaveBeenCalled()
    })

    it('uses a long-lived runner that never wrote hubReadyAt', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
        readRunnerStateMock.mockResolvedValue({
            pid: 4242,
            startTime: new Date(Date.now() - 10 * 60_000).toISOString(),
        })
        isProcessAliveMock.mockReturnValue(true)

        const result = await bootstrapSession({
            flavor: 'cursor',
            workingDirectory: '/tmp/project'
        })

        expect(result.machineId).toBe('machine-1')
        expect(spawnHappyCLIMock).not.toHaveBeenCalled()
    })

    it('treats an unparseable legacy startTime as a live older runner', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        getMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
        readRunnerStateMock.mockResolvedValue({
            pid: 4242,
            startTime: '16/10/2026, 12:34:56',
        })
        isProcessAliveMock.mockReturnValue(true)

        const result = await bootstrapSession({
            flavor: 'cursor',
            workingDirectory: '/tmp/project'
        })

        expect(result.machineId).toBe('machine-1')
        expect(spawnHappyCLIMock).not.toHaveBeenCalled()
    })

    it('follows settings.machineId after the runner rotates a legacy row', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        let settingsReads = 0
        readSettingsMock.mockImplementation(async () => {
            settingsReads += 1
            if (settingsReads < 3) {
                return { machineId: 'machine-legacy', machineTag: 'secret-tag' }
            }
            return { machineId: 'machine-rotated', machineTag: 'secret-tag' }
        })
        let runnerPolls = 0
        readRunnerStateMock.mockImplementation(async () => {
            runnerPolls += 1
            if (runnerPolls < 2) {
                return { pid: 4242, hubReadyAt: 0, startTime: new Date().toISOString() }
            }
            return { pid: 4242, hubReadyAt: 1 }
        })
        getMachineMock.mockImplementation(async (id?: string) => ({ id: id ?? 'machine-legacy' }))

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(result.machineId).toBe('machine-rotated')
        expect(getOrCreateSessionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({ machineId: 'machine-rotated' }),
            })
        )
        expect(getOrCreateMachineMock).not.toHaveBeenCalled()
    })

    it('keeps polling when machine lookup hits a transient hub error', async () => {
        const session = createSession()
        getOrCreateSessionMock.mockResolvedValue(session)
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
        getMachineMock
            .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
            .mockResolvedValue({ id: 'machine-1' })

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(result.machineId).toBe('machine-1')
        expect(getMachineMock).toHaveBeenCalledTimes(2)
    })

    it('passes reservedSessionId as getOrCreateSession id (adopt-stub, #1911)', async () => {
        const session = createSession()
        session.id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        getOrCreateSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project',
            reservedSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        })

        expect(getOrCreateSessionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                adopt: true,
            })
        )
        expect(result.sessionInfo.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    })

    it('does not bind non-UUID reservedSessionId (reap stamp only; hub rejects non-uuid id)', async () => {
        const session = createSession()
        session.id = 'minted-hub-id'
        getOrCreateSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project',
            reservedSessionId: 'spawned-test-456'
        })

        expect(getOrCreateSessionMock).toHaveBeenCalledWith(
            expect.not.objectContaining({ id: expect.anything() })
        )
        // Call args should omit `id` entirely:
        const call = getOrCreateSessionMock.mock.calls[0][0] as { id?: string }
        expect(call.id).toBeUndefined()
    })

    it('throws when hub returns a different id than reservedSessionId', async () => {
        const session = createSession()
        session.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        getOrCreateSessionMock.mockResolvedValue(session)
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({ isPending: () => false })
        readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })

        await expect(bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project',
            reservedSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        })).rejects.toThrow(/unexpected session id/)
    })
})

describe('buildMachineMetadata runner-only capabilities', () => {
    const originalSupervised = process.env.HAPI_RUNNER_SUPERVISED

    afterEach(() => {
        if (originalSupervised === undefined) {
            delete process.env.HAPI_RUNNER_SUPERVISED
        } else {
            process.env.HAPI_RUNNER_SUPERVISED = originalSupervised
        }
    })

    it('omits machine RPC capabilities for terminal bootstrap metadata', () => {
        delete process.env.HAPI_RUNNER_SUPERVISED
        const metadata = buildMachineMetadata()
        expect(metadata.capabilities).toBeUndefined()
        expect(metadata.startedCliMtimeMs).toBeUndefined()
        expect(metadata.installedCliMtimeMs).toBeUndefined()
        expect(metadata.supervisedRestart).toBeUndefined()
    })

    it('advertises capabilities and supervisedRestart only for asRunner', () => {
        process.env.HAPI_RUNNER_SUPERVISED = '1'
        const metadata = buildMachineMetadata({ asRunner: true, startedCliMtimeMs: 42 })
        expect(metadata.capabilities).toEqual(expect.arrayContaining(['cursor-chat-store-status', 'stop-runner']))
        expect(metadata.startedCliMtimeMs).toBe(42)
        expect(metadata.installedCliMtimeMs).toBe(1_700_000_000_000)
        expect(metadata.supervisedRestart).toBe(true)
    })

    it('always sends supervisedRestart boolean for asRunner so sticky true can clear', () => {
        delete process.env.HAPI_RUNNER_SUPERVISED
        const metadata = buildMachineMetadata({ asRunner: true })
        expect(metadata.capabilities).toEqual(expect.arrayContaining(['stop-runner']))
        expect(metadata.supervisedRestart).toBe(false)
    })
})
