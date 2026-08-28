/**
 * WebSocket client for machine/runner communication with hapi-hub
 */

import { io, type Socket } from 'socket.io-client'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'
import type { ClientToServerEvents, ServerToClientEvents, Update, UpdateMachineBody } from '@hapi/protocol'
import {
    ArchiveCodexSessionRpcRequestSchema,
    ListCodexSessionsRpcRequestSchema,
    ListClaudeSessionsRpcRequestSchema,
    ListCursorImportableSessionsRpcRequestSchema,
    ListPiSessionsRpcRequestSchema,
    PrepareCursorImportRpcRequestSchema,
    type ArchiveCodexSessionRpcResponse,
    type AgentAvailabilityResponse,
    type ListCodexSessionsRpcResponse,
    type ListClaudeSessionsRpcResponse,
    type ListCursorImportableSessionsRpcResponse,
    type ListPiSessionsRpcResponse,
    type PrepareCursorImportRpcResponse,
    type MachineDirectoryEntry,
    type MachineListDirectoryResponse,
    type PathExistsResponse
} from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { RUNNER_CAPABILITIES } from '@hapi/protocol'
import type { RunnerState, Machine, MachineMetadata } from './types'
import { RunnerStateSchema, MachineMetadataSchema } from './types'
import { getInstalledCliMtimeMs } from '@/runner/controlClient'
import { backoff } from '@/utils/time'
import { getInvokedCwd } from '@/utils/invokedCwd'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import {
    listOpencodeModelsForCwd,
    type ListOpencodeModelsForCwdRequest,
    type ListOpencodeModelsForCwdResponse
} from '../modules/common/opencodeModels'
import {
    listGrokModelsForCwd,
    type ListGrokModelsForCwdRequest,
    type ListGrokModelsForCwdResponse
} from '../modules/common/grokModels'
import {
    listCopilotModelsForCwd,
    type ListCopilotModelsForCwdRequest,
    type ListCopilotModelsForCwdResponse
} from '../modules/common/copilotModels'
import type { SpawnSessionOptions, SpawnSessionResult } from '../modules/common/rpcTypes'
import { applyVersionedAck } from './versionedUpdate'
import { archiveLocalCodexSession, listLocalCodexSessionSummaries, listLocalCodexSessionsWithMessagesByIds } from '../modules/common/codexSessions'
import { listLocalClaudeSessionSummaries, listLocalClaudeSessionsWithMessagesByIds } from '../modules/common/claudeSessions'
import { listLocalPiSessionSummaries, listLocalPiSessionsWithMessagesByIds } from '../modules/common/piSessions'
import { buildSocketIoExtraHeaderOptions } from './hubExtraHeaders'
import { collectMachineHealth } from '@/utils/machineHealth'
import { inspectCursorChatStore } from '@/cursor/cursorChatStoreStatus'
import { homedir } from 'node:os'
import type { CursorChatStoreStatus } from '@hapi/protocol/apiTypes'
import type { HubUpgradeOffer, RunnerSelfUpgradeResponse } from '@hapi/protocol/upgradeChannel'
import { applyRunnerSelfUpgrade } from '@/upgrade/selfUpgrade'
import { buildMachineMetadata } from '@/agent/sessionFactory'
import {
    machineRegistrationNeedsRefresh,
} from '@hapi/protocol/machineRegistration'
import { MachinePathPolicy } from './machinePathPolicy'
import { getAgentAvailabilityResponse } from '@/agent/agentAvailability'

export { normalizeWindowsDriveRoot } from './machinePathPolicy'

type MachineRpcHandlers = {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
    stopSession: (sessionId: string) => Promise<'stopped' | 'already_gone' | 'still_alive'>
    requestShutdown: () => void
}

interface PathExistsRequest {
    paths: string[]
}

interface ListMachineDirectoryRequest {
    path: string
    includeHidden?: boolean
}

interface CursorChatStoreStatusRequest {
    workspacePath: string
    cursorSessionId: string
    homeDir?: string
}

function workspaceRootsEqual(left?: string[], right?: string[]): boolean {
    const normalizedLeft = left ?? []
    const normalizedRight = right ?? []
    if (normalizedLeft.length !== normalizedRight.length) {
        return false
    }

    return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function formatWorkspaceRoots(paths?: string[]): string {
    return paths?.length ? paths.join(', ') : '(none)'
}

export class ApiMachineClient {
    private socket!: Socket<ServerToClientEvents, ClientToServerEvents>
    private keepAliveInterval: NodeJS.Timeout | null = null
    private keepAliveStartTimeout: ReturnType<typeof setTimeout> | null = null
    private rpcHandlerManager: RpcHandlerManager

    private readonly pathPolicy: MachinePathPolicy

    constructor(
        private readonly token: string,
        private readonly machine: Machine,
        private readonly workspaceRoots?: string[],
        private readonly machineTag?: string,
        /** Memory-only runner-generation proof — never settings / child env (#1473). */
        private readonly runnerProof?: string
    ) {
        this.pathPolicy = new MachinePathPolicy({
            workspaceRoots,
            homeDirectory: this.machine.metadata?.homeDir ?? homedir(),
        })

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.machine.id,
            logger: (msg, data) => logger.debug(msg, data)
        })

        registerCommonHandlers(this.rpcHandlerManager, getInvokedCwd())

        this.rpcHandlerManager.registerHandler<unknown, AgentAvailabilityResponse>(
            RPC_METHODS.AgentAvailability,
            async () => getAgentAvailabilityResponse()
        )

        this.rpcHandlerManager.registerHandler<PathExistsRequest, PathExistsResponse>(RPC_METHODS.PathExists, async (params) => {
            const rawPaths = Array.isArray(params?.paths) ? params.paths : []
            const uniquePaths = Array.from(new Set(rawPaths.filter((path): path is string => typeof path === 'string')))
            const exists: Record<string, boolean> = {}
            const outsideWorkspaceRoots: string[] = []

            await Promise.all(uniquePaths.map(async (path) => {
                const trimmed = path.trim()
                if (!trimmed) return
                const resolved = await this.pathPolicy.resolveForCheck(trimmed)
                if (!this.pathPolicy.isWithinSpawnRoots(resolved)) {
                    exists[trimmed] = false
                    outsideWorkspaceRoots.push(trimmed)
                    return
                }
                try {
                    const stats = await stat(resolved)
                    exists[trimmed] = stats.isDirectory()
                } catch {
                    exists[trimmed] = false
                }
            }))

            return {
                exists,
                ...(outsideWorkspaceRoots.length > 0 ? { outsideWorkspaceRoots } : {}),
            }
        })

        this.rpcHandlerManager.registerHandler<CursorChatStoreStatusRequest, CursorChatStoreStatus>(
            RPC_METHODS.CursorChatStoreStatus,
            async (params) => {
                const recordedHome = typeof params?.homeDir === 'string' ? params.homeDir.trim() : ''
                return await inspectCursorChatStore({
                    home: recordedHome || homedir(),
                    workspacePath: typeof params?.workspacePath === 'string' ? params.workspacePath : '',
                    cursorSessionId: typeof params?.cursorSessionId === 'string' ? params.cursorSessionId : ''
                })
            }
        )

        this.rpcHandlerManager.registerHandler<ListMachineDirectoryRequest, MachineListDirectoryResponse>(RPC_METHODS.ListMachineDirectory, async (params) => {
            const rawPath = typeof params?.path === 'string' ? params.path.trim() : ''
            if (!rawPath) {
                return { success: false, error: 'Path is required' }
            }

            const includeHidden = params?.includeHidden === true

            const targetPath = await this.pathPolicy.resolveForCheck(rawPath)
            if (!this.pathPolicy.isWithinBrowseRoots(targetPath)) {
                return { success: false, error: 'Path is outside browse roots' }
            }

            try {
                const dirStat = await stat(targetPath)
                if (!dirStat.isDirectory()) {
                    return { success: false, error: 'Path is not a directory' }
                }

                const dirEntries = await readdir(targetPath, { withFileTypes: true })
                const entries: MachineDirectoryEntry[] = []

                await Promise.all(dirEntries.map(async (entry) => {
                    if (!includeHidden && entry.name.startsWith('.')) return

                    const fullPath = join(targetPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined
                    let isGitRepo = false

                    if (entry.isDirectory()) {
                        type = 'directory'
                        try {
                            const gitStat = await stat(join(fullPath, '.git'))
                            isGitRepo = gitStat.isDirectory() || gitStat.isFile()
                        } catch {
                            // not a git repo
                        }
                    } else if (entry.isFile()) {
                        type = 'file'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch {
                            // ignore stat errors
                        }
                    }

                    entries.push({ name: entry.name, type, size, modified, isGitRepo })
                }))

                entries.sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1
                    if (a.type !== 'directory' && b.type === 'directory') return 1
                    return a.name.localeCompare(b.name)
                })

                return { success: true, entries }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }
            }
        })

        // OpenCode model discovery spawns an `opencode acp` subprocess scoped to the
        // requested cwd, so it must obey the same workspace-root containment as
        // `list-directory` and `spawn-happy-session`. Re-register the handler that
        // `registerCommonHandlers` installed unguarded with a guarded version that
        // resolves symlinks and rejects paths outside the configured root before
        // delegating to the lower-level probe. This intentionally overwrites the
        // earlier registration on the same scoped method name.
        this.rpcHandlerManager.registerHandler<ListOpencodeModelsForCwdRequest, ListOpencodeModelsForCwdResponse>(
            RPC_METHODS.ListOpencodeModelsForCwd,
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) {
                    return { success: false, error: 'cwd is required' }
                }

                const resolvedCwd = await this.pathPolicy.resolveForCheck(rawCwd)
                if (!this.pathPolicy.isWithinSpawnRoots(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace roots' }
                }

                return await listOpencodeModelsForCwd(resolvedCwd)
            }
        )

        this.rpcHandlerManager.registerHandler<ListGrokModelsForCwdRequest, ListGrokModelsForCwdResponse>(
            RPC_METHODS.ListGrokModelsForCwd,
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) return { success: false, error: 'cwd is required' }

                const resolvedCwd = await this.pathPolicy.resolveForCheck(rawCwd)
                if (!this.pathPolicy.isWithinSpawnRoots(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace roots' }
                }

                return await listGrokModelsForCwd(resolvedCwd)
            }
        )

        this.rpcHandlerManager.registerHandler<ListCopilotModelsForCwdRequest, ListCopilotModelsForCwdResponse>(
            RPC_METHODS.ListCopilotModelsForCwd,
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) return { success: false, error: 'cwd is required' }

                const resolvedCwd = await this.pathPolicy.resolveForCheck(rawCwd)
                if (!this.pathPolicy.isWithinSpawnRoots(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace roots' }
                }

                return await listCopilotModelsForCwd(resolvedCwd)
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ListCodexSessionsRpcResponse>(
            RPC_METHODS.ListCodexSessions,
            async (params) => {
                const parsed = ListCodexSessionsRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Codex sessions request' }
                const rawCwd = typeof parsed.data.cwd === 'string' ? parsed.data.cwd.trim() : ''
                if (rawCwd) {
                    const resolvedCwd = await this.pathPolicy.resolveForCheck(rawCwd)
                    if (!this.pathPolicy.isWithinSpawnRoots(resolvedCwd)) {
                        return { success: false, error: 'Path is outside workspace roots' }
                    }
                }
                const requestedIds = parsed.data.sessionIds
                    ? new Set(parsed.data.sessionIds)
                    : null
                const allSessions = requestedIds
                    ? listLocalCodexSessionsWithMessagesByIds(requestedIds)
                    : listLocalCodexSessionSummaries()
                const sessions = []
                for (const session of allSessions) {
                    if (await this.isLocalSessionWithinWorkspaceRoots(session)) {
                        sessions.push(session)
                    }
                }
                return { success: true, sessions }
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ListClaudeSessionsRpcResponse>(
            RPC_METHODS.ListClaudeSessions,
            async (params) => {
                const parsed = ListClaudeSessionsRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Claude sessions request' }
                const rawCwd = typeof parsed.data.cwd === 'string' ? parsed.data.cwd.trim() : ''
                if (rawCwd) {
                    const resolvedCwd = await this.resolveForWorkspaceCheck(rawCwd)
                    if (!this.isWithinWorkspaceRoots(resolvedCwd)) {
                        return { success: false, error: 'Path is outside workspace roots' }
                    }
                }
                const requestedIds = parsed.data.sessionIds
                    ? new Set(parsed.data.sessionIds)
                    : null
                const allSessions = requestedIds
                    ? listLocalClaudeSessionsWithMessagesByIds(requestedIds)
                    : listLocalClaudeSessionSummaries()
                const sessions = []
                for (const session of allSessions) {
                    if (await this.isSessionCwdWithinWorkspaceRoots(session.cwd)) {
                        sessions.push(session)
                    }
                }
                return { success: true, sessions }
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ListPiSessionsRpcResponse>(
            RPC_METHODS.ListPiSessions,
            async (params) => {
                const parsed = ListPiSessionsRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Pi sessions request' }
                const rawCwd = typeof parsed.data.cwd === 'string' ? parsed.data.cwd.trim() : ''
                if (rawCwd) {
                    const resolvedCwd = await this.pathPolicy.resolveForCheck(rawCwd)
                    if (!this.pathPolicy.isWithinSpawnRoots(resolvedCwd)) {
                        return { success: false, error: 'Path is outside workspace roots' }
                    }
                }
                const requestedIds = parsed.data.sessionIds ? new Set(parsed.data.sessionIds) : null
                const allSessions = requestedIds
                    ? listLocalPiSessionsWithMessagesByIds(requestedIds)
                    : listLocalPiSessionSummaries()
                const sessions = []
                for (const session of allSessions) {
                    if (await this.isSessionCwdWithinWorkspaceRoots(session.cwd)) sessions.push(session)
                }
                return { success: true, sessions }
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ListCursorImportableSessionsRpcResponse>(
            RPC_METHODS.ListCursorImportableSessions,
            async (params) => {
                const parsed = ListCursorImportableSessionsRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Cursor importable sessions request' }
                // Dynamic import: cursorImportSessions pulls bun:sqlite, which Vitest/Node
                // cannot resolve at module-graph time. Keep that off the apiMachine hot path.
                const { listCursorImportableSessionsOnDisk } = await import('../modules/common/cursorImportSessions')
                const allSessions = listCursorImportableSessionsOnDisk({
                    home: homedir(),
                    candidateWorkspacePaths: parsed.data.candidateWorkspacePaths,
                    limit: parsed.data.limit
                })
                const sessions = []
                for (const session of allSessions) {
                    if (await this.isSessionCwdWithinWorkspaceRoots(session.workspacePath)) {
                        sessions.push(session)
                    }
                }
                return { success: true, sessions }
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, PrepareCursorImportRpcResponse>(
            RPC_METHODS.PrepareCursorImport,
            async (params) => {
                const parsed = PrepareCursorImportRpcRequestSchema.safeParse(params)
                if (!parsed.success) {
                    const rawUuid = typeof (params as Record<string, unknown> | null)?.uuid === 'string'
                        ? String((params as Record<string, unknown>).uuid).trim() || 'invalid'
                        : 'invalid'
                    return {
                        success: false,
                        uuid: rawUuid,
                        reason: 'internal_error',
                        message: 'Invalid Cursor import prepare request',
                        durationMs: 0
                    }
                }
                const workspacePath = typeof parsed.data.workspacePath === 'string' ? parsed.data.workspacePath.trim() : ''
                if (workspacePath) {
                    const resolvedCwd = await this.resolveForWorkspaceCheck(workspacePath)
                    if (!this.isWithinWorkspaceRoots(resolvedCwd)) {
                        return {
                            success: false,
                            uuid: parsed.data.uuid,
                            reason: 'internal_error',
                            message: 'Path is outside workspace roots',
                            durationMs: 0
                        }
                    }
                }
                const { prepareCursorImportOnDisk } = await import('../modules/common/cursorImportSessions')
                return await prepareCursorImportOnDisk({
                    uuid: parsed.data.uuid.trim(),
                    workspacePath: parsed.data.workspacePath ?? null,
                    home: homedir()
                })
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ArchiveCodexSessionRpcResponse>(
            RPC_METHODS.ArchiveCodexSession,
            async (params) => {
                const parsed = ArchiveCodexSessionRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Codex archive request' }
                const sessionId = parsed.data.sessionId.trim()
                return await archiveLocalCodexSession(sessionId, {
                    canArchive: (session) => this.isLocalSessionWithinWorkspaceRoots(session)
                })
            }
        )
    }

    private async isLocalSessionWithinWorkspaceRoots(session: { cwd?: string | null }): Promise<boolean> {
        if (!this.pathPolicy.hasWorkspaceRoots()) return true
        const cwd = session.cwd?.trim()
        if (!cwd) return false
        const resolvedCwd = await this.pathPolicy.resolveForCheck(cwd)
        return this.pathPolicy.isWithinSpawnRoots(resolvedCwd)
    }

    setRPCHandlers({ spawnSession, stopSession, requestShutdown }: MachineRpcHandlers): void {
        this.rpcHandlerManager.registerHandler(RPC_METHODS.SpawnHappySession, async (params: any) => {
            const { directory, sessionId, existingSessionId, resumeSessionId, machineId, approvedNewDirectoryCreation, agent, model, effort, modelReasoningEffort, yolo, permissionMode, serviceTier, collaborationMode, copilotAgentMode, token, sessionType, worktreeName, startingMode, forkSession } = params || {}

            if (!directory) {
                throw new Error('Directory is required')
            }

            const resolvedDirectory = await this.pathPolicy.resolveForCheck(directory)
            if (!this.pathPolicy.isWithinSpawnRoots(resolvedDirectory)) {
                return {
                    type: 'error',
                    errorMessage: 'Directory is outside this machine\'s workspace roots',
                    code: 'outside_workspace_roots',
                }
            }

            const result = await spawnSession({
                directory,
                sessionId,
                existingSessionId,
                resumeSessionId,
                machineId,
                approvedNewDirectoryCreation,
                agent,
                model,
                effort,
                modelReasoningEffort,
                yolo,
                permissionMode,
                serviceTier,
                collaborationMode,
                copilotAgentMode,
                token,
                sessionType,
                worktreeName,
                startingMode,
                forkSession: forkSession === true,
                validateDirectory: async (path) => await this.pathPolicy.allowsSpawn(path),
            })

            switch (result.type) {
                case 'success':
                    return { type: 'success', sessionId: result.sessionId }
                case 'requestToApproveDirectoryCreation':
                    return { type: 'requestToApproveDirectoryCreation', directory: result.directory }
                case 'error':
                    return {
                        type: 'error',
                        errorMessage: result.errorMessage,
                        code: result.code,
                        agent: result.agent,
                    }
            }
        })

        this.rpcHandlerManager.registerHandler(RPC_METHODS.StopSession, async (params: any) => {
            const { sessionId } = params || {}
            if (!sessionId) {
                throw new Error('Session ID is required')
            }

            const status = await stopSession(sessionId)
            return { status }
        })

        this.rpcHandlerManager.registerHandler(RPC_METHODS.StopRunner, () => {
            setTimeout(() => requestShutdown(), 100)
            return { message: 'Runner stop request acknowledged' }
        })

        this.rpcHandlerManager.registerHandler<
            { offer: HubUpgradeOffer },
            RunnerSelfUpgradeResponse
        >(RPC_METHODS.RunnerSelfUpgrade, async (params) => {
            const offer = params?.offer
            if (!offer || typeof offer !== 'object') {
                throw new Error('offer is required')
            }
            return await applyRunnerSelfUpgrade({
                offer,
                downloadBaseUrl: configuration.apiUrl,
                authToken: configuration.cliApiToken,
                requestShutdown: () => {
                    setTimeout(() => requestShutdown(), 500)
                },
            })
        })
    }

    async updateMachineMetadata(handler: (metadata: MachineMetadata | null) => MachineMetadata): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.metadata)

            const answer = await this.socket.emitWithAck('machine-update-metadata', {
                machineId: this.machine.id,
                metadata: updated,
                expectedVersion: this.machine.metadataVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'metadata',
                parseValue: (value) => {
                    const parsed = MachineMetadataSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.metadata = value
                },
                applyVersion: (version) => {
                    this.machine.metadataVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid metadata value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-metadata response',
                errorMessage: 'Machine metadata update failed',
                versionMismatchMessage: 'Metadata version mismatch'
            })
        })
    }

    async updateRunnerState(handler: (state: RunnerState | null) => RunnerState): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.runnerState)

            const answer = await this.socket.emitWithAck('machine-update-state', {
                machineId: this.machine.id,
                runnerState: updated,
                expectedVersion: this.machine.runnerStateVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'runnerState',
                parseValue: (value) => {
                    const parsed = RunnerStateSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.runnerState = value
                },
                applyVersion: (version) => {
                    this.machine.runnerStateVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid runnerState value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-state response',
                errorMessage: 'Machine state update failed',
                versionMismatchMessage: 'Runner state version mismatch'
            })
        })
    }

    connect(): void {
        this.socket = io(`${configuration.apiUrl}/cli`, {
            transports: ['websocket'],
            auth: {
                token: this.token,
                clientType: 'machine-scoped' as const,
                machineId: this.machine.id,
                ...(this.machineTag ? { machineTag: this.machineTag } : {}),
                ...(this.runnerProof ? { runnerProof: this.runnerProof } : {}),
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            ...buildSocketIoExtraHeaderOptions()
        })

        this.socket.on('connect', () => {
            logger.debug('[API MACHINE] Connected to bot')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            this.updateRunnerState((state) => ({
                ...(state ?? {}),
                status: 'running',
                pid: process.pid,
                httpPort: this.machine.runnerState?.httpPort,
                startedAt: Date.now(),
                capabilities: { ...RUNNER_CAPABILITIES }
            })).catch((error) => {
                logger.debug('[API MACHINE] Failed to update runner state on connect', error)
            })

            const hubWorkspaceRoots = this.machine.metadata?.workspaceRoots
            const desiredWorkspaceRoots = this.workspaceRoots
            const identity = buildMachineMetadata({
                workspaceRoots: desiredWorkspaceRoots?.length ? desiredWorkspaceRoots : undefined,
                startedCliMtimeMs: this.machine.metadata?.startedCliMtimeMs,
                asRunner: true,
            })
            const needsRoots = !workspaceRootsEqual(desiredWorkspaceRoots, hubWorkspaceRoots)
            const needsIdentity = machineRegistrationNeedsRefresh(this.machine.metadata, identity)

            if (needsRoots || needsIdentity) {
                if (needsRoots) {
                    if (desiredWorkspaceRoots?.length) {
                        console.log(`[HAPI] Syncing workspace roots to hub: ${formatWorkspaceRoots(desiredWorkspaceRoots)} (current hub value: ${formatWorkspaceRoots(hubWorkspaceRoots)})`)
                    } else {
                        console.log(`[HAPI] Clearing workspace roots on hub (was: ${formatWorkspaceRoots(hubWorkspaceRoots)})`)
                    }
                }
                if (needsIdentity) {
                    console.log(`[HAPI] Refreshing machine identity on hub (version=${identity.happyCliVersion}, capabilities=${(identity.capabilities ?? []).join(',') || '(none)'})`)
                }
                this.updateMachineMetadata((current) => {
                    const merged = {
                        ...identity,
                        displayName: current?.displayName,
                        startedCliMtimeMs: current?.startedCliMtimeMs ?? identity.startedCliMtimeMs,
                    }
                    if (desiredWorkspaceRoots?.length) {
                        return { ...merged, workspaceRoots: desiredWorkspaceRoots }
                    }
                    const { workspaceRoots: _workspaceRoots, ...rest } = merged
                    return rest as MachineMetadata
                }).then(() => {
                    if (needsRoots) {
                        console.log(`[HAPI] Workspace roots synced: ${formatWorkspaceRoots(this.machine.metadata?.workspaceRoots)}`)
                    }
                }).catch((error) => {
                    console.error('[HAPI] Failed to sync machine metadata:', error instanceof Error ? error.message : error)
                })
            } else if (desiredWorkspaceRoots?.length) {
                console.log(`[HAPI] Workspace roots already up to date on hub: ${formatWorkspaceRoots(desiredWorkspaceRoots)}`)
            }

            this.startKeepAlive()
        })

        this.socket.on('disconnect', () => {
            logger.debug('[API MACHINE] Disconnected from bot')
            this.rpcHandlerManager.onSocketDisconnect()
            this.stopKeepAlive()
        })

        this.socket.on('rpc-request', async (data: { method: string; params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        this.socket.on('update', (data: Update) => {
            if (data.body.t !== 'update-machine') {
                return
            }

            const update = data.body as UpdateMachineBody
            if (update.machineId !== this.machine.id) {
                return
            }

            if (update.metadata) {
                const parsed = MachineMetadataSchema.safeParse(update.metadata.value)
                if (parsed.success) {
                    this.machine.metadata = parsed.data
                } else {
                    logger.debug('[API MACHINE] Ignoring invalid metadata update', { version: update.metadata.version })
                }
                this.machine.metadataVersion = update.metadata.version
            }

            if (update.runnerState) {
                const next = update.runnerState.value
                if (next == null) {
                    this.machine.runnerState = null
                } else {
                    const parsed = RunnerStateSchema.safeParse(next)
                    if (parsed.success) {
                        this.machine.runnerState = parsed.data
                    } else {
                        logger.debug('[API MACHINE] Ignoring invalid runnerState update', { version: update.runnerState.version })
                    }
                }
                this.machine.runnerStateVersion = update.runnerState.version
            }
        })

        this.socket.on('connect_error', (error) => {
            logger.debug(`[API MACHINE] Connection error: ${error.message}`)
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API MACHINE] Socket error:', payload)
        })
    }

    /**
     * Create the socket and resolve only after the first successful `connect`
     * event (after onSocketConnect / RPC registration). Used by upgrade/mtime
     * handoff so hubReadyAt is not written for a half-connected child.
     *
     * Transient `connect_error` events are ignored — Socket.IO reconnection
     * stays active until success or timeout.
     */
    connectUntilReady(timeoutMs = 30_000): Promise<void> {
        return new Promise((resolve, reject) => {
            this.connect()
            if (!this.socket) {
                reject(new Error('Machine socket was not created'))
                return
            }
            const timer = setTimeout(() => {
                this.socket?.off('connect', onConnect)
                reject(new Error(`Machine socket connect timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            const onConnect = (): void => {
                clearTimeout(timer)
                resolve()
            }
            // Registered after connect()'s own handlers so onSocketConnect runs first.
            this.socket.once('connect', onConnect)
        })
    }

    private startKeepAlive(): void {
        this.stopKeepAlive()
        const emitAlive = () => {
            // Re-register RPCs every heartbeat. Hub restarts clear the in-memory
            // RpcRegistry; fire-and-forget connect-time registration can be
            // dropped while this socket keeps sending machine-alive. Without
            // this, Teemo/proxmox stay "active" with zero machine RPCs until a
            // full reconnect.
            this.rpcHandlerManager.reregisterAll()
            this.socket.emit('machine-alive', {
                machineId: this.machine.id,
                time: Date.now(),
                health: collectMachineHealth()
            })
            const installedCliMtimeMs = getInstalledCliMtimeMs()
            if (!this.machine.metadata) {
                return
            }
            // Keepalive must refresh capabilities/version too — `/cli/machines`
            // historically returned stale rows for existing machines, and a
            // long-lived socket may never reconnect after a binary upgrade.
            const identity = buildMachineMetadata({
                workspaceRoots: this.workspaceRoots?.length ? this.workspaceRoots : undefined,
                startedCliMtimeMs: this.machine.metadata.startedCliMtimeMs,
                asRunner: true,
            })
            const needsIdentity = machineRegistrationNeedsRefresh(this.machine.metadata, identity)
            const needsInstalledMtime = typeof installedCliMtimeMs === 'number'
                && this.machine.metadata.installedCliMtimeMs !== installedCliMtimeMs
            if (!needsIdentity && !needsInstalledMtime) {
                return
            }
            void this.updateMachineMetadata((current) => {
                const base: MachineMetadata = {
                    ...identity,
                    displayName: current?.displayName,
                    startedCliMtimeMs: current?.startedCliMtimeMs ?? identity.startedCliMtimeMs,
                    ...(typeof installedCliMtimeMs === 'number' ? { installedCliMtimeMs } : {}),
                }
                if (this.workspaceRoots?.length) {
                    return { ...base, workspaceRoots: this.workspaceRoots }
                }
                // Keepalive must not clear workspace roots; connect owns that sync.
                if (current?.workspaceRoots?.length) {
                    return { ...base, workspaceRoots: current.workspaceRoots }
                }
                return base
            }).catch((error) => {
                logger.debug('[API MACHINE] Failed to refresh machine identity on keepalive', error)
            })
        }
        // Prime CPU sampling so the first heartbeat already includes CPU %.
        collectMachineHealth()
        this.keepAliveStartTimeout = setTimeout(() => {
            this.keepAliveStartTimeout = null
            emitAlive()
            this.keepAliveInterval = setInterval(emitAlive, 20_000)
        }, 50)
    }

    private stopKeepAlive(): void {
        if (this.keepAliveStartTimeout) {
            clearTimeout(this.keepAliveStartTimeout)
            this.keepAliveStartTimeout = null
        }
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval)
            this.keepAliveInterval = null
        }
    }

    shutdown(): void {
        this.stopKeepAlive()
        if (this.socket) {
            this.socket.close()
        }
    }
}
