import axios from 'axios'
import type { AgentState, ClearOpencodeSessionCallbackRequest, ClearOpencodeSessionResponse, CreateMachineResponse, CreateSessionResponse, RunnerState, Machine, MachineMetadata, Metadata, Session } from '@/api/types'
import { applyHubSessionSummaryContract } from '@/modules/common/sessionSummaryInstruction'
import type { LocalResumeTarget, ResumableSession } from '@hapi/protocol'
import {
    AgentStateSchema,
    ClearOpencodeSessionResponseSchema,
    CreateMachineResponseSchema,
    CreateSessionResponseSchema,
    GetSessionResponseSchema,
    LocalHandoffResponseSchema,
    LocalResumeTargetResponseSchema,
    RunnerStateSchema,
    MachineMetadataSchema,
    MetadataSchema,
    ResumableSessionsResponseSchema
} from '@/api/types'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import {
    LEGACY_MACHINE_REENROLL_MESSAGE,
    rotateMachineIdForLegacyReenroll,
} from '@/ui/auth'
import { apiValidationError } from '@/utils/errorUtils'
import { ApiMachineClient } from './apiMachine'
import { ApiSessionClient, type ApiSessionClientOptions } from './apiSession'
import { buildHubRequestHeaders } from './hubExtraHeaders'

function isLegacyMachineReenrollError(error: unknown): boolean {
    if (!axios.isAxiosError(error) || error.response?.status !== 409) {
        return false
    }
    const body = error.response.data
    if (!body || typeof body !== 'object') {
        return false
    }
    const message = (body as { error?: unknown }).error
    return typeof message === 'string' && message === LEGACY_MACHINE_REENROLL_MESSAGE
}

export class ApiClient {
    static async create(): Promise<ApiClient> {
        return new ApiClient(getAuthToken())
    }

    private constructor(private readonly token: string) { }

    private authHeaders(): Record<string, string> {
        return buildHubRequestHeaders({
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        })
    }

    async getOrCreateSession(opts: {
        id?: string
        tag: string
        metadata: Metadata
        state: AgentState | null
        model?: string
        modelReasoningEffort?: string
        effort?: string
        machine?: {
            id: string
            tag?: string
            metadata: MachineMetadata
            runnerState?: RunnerState
        }
        /** Fired when hub forces legacy machine re-enroll before the create succeeds. */
        onMachineReenrolled?: (machineId: string, machineTag: string) => void
        timeoutMs?: number
        signal?: AbortSignal
    }): Promise<Session & { sessionCapability?: string }> {
        try {
            return await this.postSession(opts)
        } catch (error) {
            if (!opts.machine || !isLegacyMachineReenrollError(error)) {
                throw error
            }
            const rotated = await rotateMachineIdForLegacyReenroll(opts.machine.id)
            opts.onMachineReenrolled?.(rotated.machineId, rotated.machineTag)
            const metadata = opts.metadata && typeof opts.metadata === 'object'
                ? { ...opts.metadata, machineId: rotated.machineId }
                : opts.metadata
            return await this.postSession({
                ...opts,
                metadata,
                machine: {
                    ...opts.machine,
                    id: rotated.machineId,
                    tag: rotated.machineTag,
                },
            })
        }
    }

    private async postSession(opts: {
        id?: string
        tag: string
        metadata: Metadata
        state: AgentState | null
        model?: string
        modelReasoningEffort?: string
        effort?: string
        machine?: {
            id: string
            tag?: string
            metadata: MachineMetadata
            runnerState?: RunnerState
        }
        timeoutMs?: number
        signal?: AbortSignal
    }): Promise<Session & { sessionCapability?: string }> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/sessions`,
            {
                id: opts.id,
                tag: opts.tag,
                metadata: opts.metadata,
                agentState: opts.state,
                model: opts.model,
                modelReasoningEffort: opts.modelReasoningEffort,
                effort: opts.effort,
                machine: opts.machine
                    ? {
                        id: opts.machine.id,
                        tag: opts.machine.tag,
                        metadata: opts.machine.metadata,
                        runnerState: opts.machine.runnerState ?? null
                    }
                    : undefined
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: opts.timeoutMs ?? 60_000,
                signal: opts.signal
            }
        )

        const parsed = CreateSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions response', response)
        }

        if (typeof parsed.data.sessionSummaryContract === 'boolean') {
            applyHubSessionSummaryContract(parsed.data.sessionSummaryContract)
        }

        const raw = parsed.data.session

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            serviceTier: raw.serviceTier,
            permissionMode: raw.permissionMode,
            collaborationMode: raw.collaborationMode,
            // Hub-minted HMAC capability for attributed peer delivery (#1203).
            ...(typeof parsed.data.sessionCapability === 'string' && parsed.data.sessionCapability
                ? { sessionCapability: parsed.data.sessionCapability }
                : {})
        }
    }

    async getSession(sessionId: string): Promise<Session> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )

        const parsed = GetSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id response', response)
        }

        if (typeof parsed.data.sessionSummaryContract === 'boolean') {
            applyHubSessionSummaryContract(parsed.data.sessionSummaryContract)
        }

        const raw = parsed.data.session
        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()
        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            serviceTier: raw.serviceTier,
            permissionMode: raw.permissionMode,
            collaborationMode: raw.collaborationMode
        }
    }

    async getOrCreateMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
        machineTag?: string
        runnerProof?: string
    }): Promise<Machine> {
        try {
            return await this.postMachine(opts)
        } catch (error) {
            if (!isLegacyMachineReenrollError(error)) {
                throw error
            }
            const rotated = await rotateMachineIdForLegacyReenroll(opts.machineId)
            return await this.postMachine({
                ...opts,
                machineId: rotated.machineId,
                machineTag: rotated.machineTag,
            })
        }
    }

    private async postMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
        machineTag?: string
        runnerProof?: string
    }): Promise<Machine> {
        const response = await axios.post<CreateMachineResponse>(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: opts.machineId,
                tag: opts.machineTag,
                runnerProof: opts.runnerProof,
                metadata: opts.metadata,
                runnerState: opts.runnerState ?? null
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: 60_000
            }
        )

        const parsed = CreateMachineResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/machines response', response)
        }

        const raw = parsed.data.machine

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MachineMetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const runnerState = (() => {
            if (raw.runnerState == null) return null
            const parsedRunnerState = RunnerStateSchema.safeParse(raw.runnerState)
            return parsedRunnerState.success ? parsedRunnerState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            runnerState,
            runnerStateVersion: raw.runnerStateVersion
        }
    }

    async listResumableSessions(machineId?: string): Promise<ResumableSession[]> {
        const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : ''
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/resumable${qs}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = ResumableSessionsResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/resumable response', response)
        }
        return parsed.data.sessions
    }

    async getLocalResumeTarget(sessionId: string): Promise<LocalResumeTarget> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/resume-target`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalResumeTargetResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id/resume-target response', response)
        }
        return parsed.data.target
    }

    async handoffSessionToLocal(sessionId: string): Promise<void> {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/handoff-local`,
            {},
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalHandoffResponseSchema.safeParse(response.data)
        if (!parsed.success || !parsed.data.ok) {
            throw apiValidationError('Invalid /cli/sessions/:id/handoff-local response', response)
        }
    }

    async clearOpenCodeSession(sessionId: string): Promise<string> {
        const response = await axios.post<ClearOpencodeSessionResponse>(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/clear-opencode`,
            {},
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = ClearOpencodeSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id/clear-opencode response', response)
        }
        return parsed.data.sessionId
    }

    async reserveOpenCodeClearSession(sessionId: string): Promise<string> {
        const response = await axios.post<ClearOpencodeSessionResponse>(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/clear-opencode/reserve`, {},
            { headers: this.authHeaders(), timeout: 60_000 }
        )
        const parsed = ClearOpencodeSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) throw apiValidationError('Invalid clear reservation response', response)
        return parsed.data.sessionId
    }

    async abortOpenCodeClearSession(sessionId: string, replacementSessionId: string): Promise<string> {
        const response = await axios.post<ClearOpencodeSessionResponse>(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/clear-opencode/abort`,
            { replacementSessionId } satisfies ClearOpencodeSessionCallbackRequest,
            { headers: this.authHeaders(), timeout: 60_000 }
        )
        const parsed = ClearOpencodeSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) throw apiValidationError('Invalid clear abort response', response)
        return parsed.data.sessionId
    }

    async confirmOpenCodeClearCleanup(sessionId: string, replacementSessionId: string): Promise<string> {
        const response = await axios.post<ClearOpencodeSessionResponse>(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/clear-opencode/confirm-cleanup`,
            { replacementSessionId } satisfies ClearOpencodeSessionCallbackRequest,
            { headers: this.authHeaders(), timeout: 60_000 }
        )
        const parsed = ClearOpencodeSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) throw apiValidationError('Invalid clear cleanup confirmation response', response)
        return parsed.data.sessionId
    }

    sessionSyncClient(
        session: Session & { sessionCapability?: string },
        options?: ApiSessionClientOptions
    ): ApiSessionClient {
        return new ApiSessionClient(this.token, session, {
            ...options,
            sessionCapability: options?.sessionCapability ?? session.sessionCapability,
            sessionTag: options?.sessionTag
        })
    }

    machineSyncClient(
        machine: Machine,
        options?: { workspaceRoots?: string[]; machineTag?: string; runnerProof?: string }
    ): ApiMachineClient {
        return new ApiMachineClient(
            this.token,
            machine,
            options?.workspaceRoots,
            options?.machineTag,
            options?.runnerProof
        )
    }
}
