import React from 'react';
import { basename } from 'node:path';
import { logger } from '@/ui/logger';
import { buildHapiMcpBridge } from '@/codex/utils/buildHapiMcpBridge';
import { convertAgentMessage } from '@/agent/messageConverter';
import { PermissionAdapter } from '@/agent/permissionAdapter';
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types';
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from '@/modules/common/remote/RemoteLauncherBase';
import { OpencodeDisplay } from '@/ui/ink/OpencodeDisplay';
import type { CursorSession } from './session';
import type { EnhancedMode, PermissionMode } from './loop';
import {
    createCursorAcpBackend,
    CURSOR_ACP_REQUIRED_MESSAGE,
    resolveCursorNativeWorktreePath
} from './utils/cursorAcpBackend';
import { setCursorAcpModelsSnapshot } from './utils/cursorAcpModelsBridge';
import { buildCursorModelsSnapshotFromAcp } from './utils/cursorAcpModelsSnapshot';
import { CursorExtensionAdapter } from './utils/cursorExtensionAdapter';
import {
    applyCursorAcpMode,
    applyCursorAcpModel,
    isCursorAutoReviewMode,
    resolveCursorModeAfterPlanApproval,
    wireIdForCursorSessionState
} from './utils/cursorModeConfig';
import { CURSOR_PLAN_CONTINUE } from './utils/cursorPlanContinue';
import { cursorPassThroughStatusMessage, parseCursorSpecialCommand } from './cursorSpecialCommands';
import { buildCursorModelsSeedPayload, seedCursorModelsCache } from '@/modules/common/cursorModels';
import { readSharedCursorModelsCache } from '@/modules/common/cursorModelsSharedCache';
import type { AcpSdkBackend } from '@/agent/backends/acp';
import type { AcpStderrError } from '@/agent/backends/acp/AcpStdioTransport';
import { registerAcpSessionTitleSync } from '@/agent/acpSessionTitle';
import {
    cursorHapiMcpServerId,
    installCursorMcpOverlay,
    type CursorMcpOverlayHandle,
} from './utils/cursorMcpOverlay';
import {
    resolveCursorSpawnModel,
    tryRemapCursorSpawnModelFromConnectError
} from './utils/cursorStaleModelRemap';
import {
    installCursorNotifyRuleOverlay,
    type CursorNotifyRuleOverlay
} from './utils/cursorNotifyRuleOverlay';
import { installCursorMcpOverlay, type CursorMcpOverlayHandle } from './utils/cursorMcpOverlay';
import {
    classifyAcpRpcRejection,
    classifyCursorAgentMessage,
    isCompletionClaim,
    mapAcpStderrToFailure,
    type CursorAgentStreamFailure
} from './cursorAgentMessageClassifier';
import {
    buildModelErrorBridgePrompt,
    canBridgeModelError,
    truncateLastUserMessage
} from './cursorModelErrorBridge';
import { getAutoBridgeTransientModelErrors } from './cursorModelErrorBridgePrefs';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';

class CursorAcpRemoteLauncher extends RemoteLauncherBase {
    private readonly session: CursorSession;
    private backend: ReturnType<typeof createCursorAcpBackend> | null = null;
    private acpSessionId: string | null = null;
    private permissionAdapter: PermissionAdapter | null = null;
    private extensionAdapter: CursorExtensionAdapter | null = null;
    private happyServer: { stop: () => void } | null = null;
    /** Transient workspace `.cursor/rules` overlay for session status summaries. */
    private notifyRuleOverlay: CursorNotifyRuleOverlay | null = null;
    private abortController = new AbortController();
    private displayPermissionMode: PermissionMode | null = null;
    private currentBackendModel: string | null = null;
    private defaultBackendModel: string | null = null;
    private unregisterModelApplyHandler: (() => void) | null = null;
    private modelApplySeq = 0;
    /** True when ACP process was spawned with `--auto-review`. */
    private spawnedWithAutoReview = false;
    /** Avoid re-queueing `/auto-review` on every mid-session mode sync. */
    private autoReviewSlashQueued = false;
    private cursorMcpOverlay: CursorMcpOverlayHandle | null = null;
    private lastAssistantText: string | null = null;
    private turnHasModelError = false;
    private lastUserMessage: string | null = null;
    private lastTurnMode: EnhancedMode | null = null;
    private bridgingForAtTs: number | null = null;
    private lastRecordedModelError: {
        atTs: number;
        kind: string;
        rawSnippet: string;
        priorAssistantClaimsDone: boolean;
        lastUserMessage: string;
        transient: boolean;
        bridgedForAtTs?: number;
        retriedAndFailed?: boolean;
    } | null = null;

    constructor(session: CursorSession) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(OpencodeDisplay, context);
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client, {
            enableChangeTitle: false,
            skillLookup: { workingDirectory: session.path, flavor: 'cursor' }
        });
        this.happyServer = happyServer;

        // Install the workspace session-summary rule before the backend spawns
        // cursor-agent, so the `.cursor/rules` file is on disk when it reads
        // workspace rules. Restored/removed in cleanup().
        this.notifyRuleOverlay = installCursorNotifyRuleOverlay({
            cwd: session.path,
            project: basename(session.path) || null
        });
        const hapiBridge = mcpServers.hapi;
        if (hapiBridge) {
            try {
                this.cursorMcpOverlay = installCursorMcpOverlay(session.path, {
                    command: hapiBridge.command,
                    args: hapiBridge.args,
                }, {
                    serverId: cursorHapiMcpServerId(session.client.sessionId),
                });
            } catch (error) {
                logger.warn(
                    '[cursor-acp] failed to install HAPI MCP overlay; continuing without inline media',
                    error,
                );
                this.cursorMcpOverlay = { cleanup: () => {} };
            }
        }

        const autoReview = isCursorAutoReviewMode(session.getPermissionMode() as PermissionMode);
        this.spawnedWithAutoReview = autoReview;

        const requestedSpawnModel = session.model;
        let spawnModel = resolveCursorSpawnModel(requestedSpawnModel);
        let backend: AcpSdkBackend | null = null;
        let recentStderrHint: string | null = null;

        for (let connectAttempt = 0; connectAttempt < 2; connectAttempt += 1) {
            if (spawnModel && spawnModel !== session.model) {
                session.setModel(spawnModel);
                session.pushKeepAlive();
                this.messageBuffer.addMessage(`[MODEL:${spawnModel}]`, 'system');
            }

            backend = createCursorAcpBackend({
                cwd: session.path,
                model: spawnModel,
                autoReview,
                worktree: session.cursorWorktree,
                addDirs: session.cursorAddDirs
            });
            this.backend = backend;
            registerAcpSessionTitleSync(backend, session.client);
            this.recordCursorNativeWorktreeMetadata();

            backend.setUsageUpdateListener((message) => this.handleAgentMessage(message));

            recentStderrHint = null;
            this.wireStderrErrorListener(backend, (hint) => {
                recentStderrHint = hint;
            });

            try {
                await backend.initialize();
                break;
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const remapped = tryRemapCursorSpawnModelFromConnectError(
                    spawnModel,
                    requestedSpawnModel,
                    errMsg,
                    recentStderrHint
                );
                await backend.disconnect();
                this.backend = null;

                if (remapped && connectAttempt === 0) {
                    logger.info(`[cursor-acp] Remapping stale spawn model ${spawnModel} → ${remapped}`);
                    spawnModel = remapped;
                    continue;
                }

                const modelRejection = extractCannotUseThisModelMessage(errMsg)
                    ?? extractCannotUseThisModelMessage(recentStderrHint);
                if (modelRejection) {
                    const fullMsg = classifyCursorAcpLoadError(error, {
                        recentStderr: recentStderrHint,
                        action: 'start'
                    });
                    const converted = convertAgentMessage({ type: 'error', message: fullMsg });
                    if (converted) {
                        session.sendAgentMessage(converted);
                    }
                    messageBuffer.addMessage(fullMsg, 'status');
                    throw new Error(fullMsg);
                }
                const fullMsg = `${CURSOR_ACP_REQUIRED_MESSAGE} (${errMsg})`;
                const converted = convertAgentMessage({ type: 'error', message: fullMsg });
                if (converted) {
                    session.sendAgentMessage(converted);
                }
                messageBuffer.addMessage(fullMsg, 'status');
                throw new Error(fullMsg);
            }
        }

        if (!backend) {
            throw new Error(CURSOR_ACP_REQUIRED_MESSAGE);
        }

        await backend.authenticateIfAvailable('cursor_login');

        const extensionAdapter = new CursorExtensionAdapter(
            session.client,
            backend,
            (message) => this.handleAgentMessage(message),
            () => this.handleCreatePlanAccepted()
        );
        this.extensionAdapter = extensionAdapter;

        this.permissionAdapter = new PermissionAdapter(
            session.client,
            backend,
            () => session.getPermissionMode(),
            (response) => extensionAdapter.handlePermissionResponse(response)
        );

        const resumeSessionId = session.sessionId;
        // Cursor ACP ignores session/new|load mcpServers; native .cursor/mcp.json is wired above.
        const mcpServerList: McpServerStdio[] = [];
        let acpSessionId: string | undefined;

        for (let loadAttempt = 0; loadAttempt < 2; loadAttempt += 1) {
            if (resumeSessionId && backend.supportsLoadSession()) {
                session.onSessionFoundWithProtocol(resumeSessionId, 'acp');
                try {
                    acpSessionId = await backend.loadSession({
                        sessionId: resumeSessionId,
                        cwd: session.path,
                        mcpServers: mcpServerList
                    });
                    break;
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    const remapped = tryRemapCursorSpawnModelFromConnectError(
                        spawnModel,
                        requestedSpawnModel,
                        errMsg,
                        recentStderrHint
                    );
                    if (remapped && loadAttempt === 0) {
                        logger.info(`[cursor-acp] Remapping stale resume model ${spawnModel} → ${remapped}`);
                        spawnModel = remapped;
                        session.setModel(remapped);
                        session.pushKeepAlive();
                        this.messageBuffer.addMessage(`[MODEL:${remapped}]`, 'system');
                        await backend.disconnect();
                        backend = createCursorAcpBackend({
                            cwd: session.path,
                            model: spawnModel,
                            autoReview,
                            worktree: session.cursorWorktree,
                            addDirs: session.cursorAddDirs
                        });
                        this.backend = backend;
                        registerAcpSessionTitleSync(backend, session.client);
                        backend.setUsageUpdateListener((message) => this.handleAgentMessage(message));
                        recentStderrHint = null;
                        this.wireStderrErrorListener(backend, (hint) => {
                            recentStderrHint = hint;
                        });
                        await backend.initialize();
                        await backend.authenticateIfAvailable('cursor_login');
                        this.extensionAdapter = new CursorExtensionAdapter(
                            session.client,
                            backend,
                            (message) => this.handleAgentMessage(message),
                            () => this.handleCreatePlanAccepted()
                        );
                        this.permissionAdapter = new PermissionAdapter(
                            session.client,
                            backend,
                            () => session.getPermissionMode(),
                            (response) => this.extensionAdapter!.handlePermissionResponse(response)
                        );
                        continue;
                    }

                    logger.warn('[cursor-acp] session/load failed', formatAcpLoadError(error));
                    throw new Error(classifyCursorAcpLoadError(error, { recentStderr: recentStderrHint }));
                }
            } else if (resumeSessionId) {
                throw new Error(
                    'Cursor ACP session/load is not supported by this agent build. Start a new Cursor session.'
                );
            } else {
                acpSessionId = await backend.newSession({
                    cwd: session.path,
                    mcpServers: mcpServerList,
                });
                break;
            }
        }
        if (!acpSessionId) {
            throw new Error('Failed to establish Cursor ACP session');
        }
        this.acpSessionId = acpSessionId;

        if (acpSessionId !== resumeSessionId) {
            session.onSessionFoundWithProtocol(acpSessionId, 'acp');
            // tiann/hapi#913: block until the metadata write that pins
            // `cursorSessionId` reaches the hub DB before we drop into
            // `runMainLoop`. If SIGTERM (hub-restart cascade) lands during
            // the first turn without this gate, the only durable handle
            // linking the session to its on-disk ACP store is lost and the
            // session strands. The resume path at lines 98-100 already
            // relies on the latency of `backend.loadSession()` to flush the
            // same write; the fresh-session path has no such cover.
            const flushed = await session.client.flushMetadata();
            if (!flushed) {
                logger.warn(`[cursor-acp] cursorSessionId metadata write did not ACK within 5s; session may be unrecoverable if killed before the lock drains (acpSessionId=${acpSessionId})`);
            }
        }

        session.client.emitSessionReady();

        syncCursorModelsFromAcp(backend, acpSessionId);

        const initialMetadata = backend.getSessionModelsMetadata(acpSessionId);
        this.currentBackendModel = initialMetadata?.currentModelId ?? session.model ?? null;
        this.defaultBackendModel = this.currentBackendModel;

        const previousSetModel = session.setModel.bind(session);

        await applyCursorAcpMode(backend, acpSessionId, session.getPermissionMode() as PermissionMode);
        if (session.model) {
            await this.applyLiveModel(backend, acpSessionId, session.model, previousSetModel, {
                optimistic: false,
                throwOnFailure: false
            });
        } else if (this.currentBackendModel && !isSpawnDefaultModel(this.currentBackendModel)) {
            this.pushModelStatusLine(this.currentBackendModel);
        }

        this.installLiveSessionConfigSync(backend, acpSessionId, previousSetModel);

        this.applyDisplayMode(session.getPermissionMode() as PermissionMode);

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        session.client.rpcHandlerManager.registerHandler(
            RPC_METHODS.BridgeModelError,
            async (payload: unknown) => this.handleBridgeModelErrorRpc(payload)
        );

        const sendReady = () => {
            if (this.turnHasModelError) {
                // Don't clear the error state with a 'ready' — banner stays visible.
                return;
            }
            session.sendSessionEvent({ type: 'ready' });
        };

        while (!this.shouldExit) {
            const waitSignal = this.abortController.signal;
            const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
            if (!batch) {
                if (waitSignal.aborted && !this.shouldExit) {
                    continue;
                }
                break;
            }

            const requestedModel = batch.mode.model === null
                ? this.defaultBackendModel
                : batch.mode.model;

            const modelChanged = Boolean(
                requestedModel && requestedModel !== this.currentBackendModel
            );
            if (modelChanged) {
                const appliedModel = await this.applyLiveModel(
                    backend,
                    acpSessionId,
                    requestedModel,
                    previousSetModel,
                    { optimistic: false, throwOnFailure: false }
                );
                batch.mode.model = appliedModel ?? this.currentBackendModel ?? undefined;
            }

            await applyCursorAcpMode(backend, acpSessionId, batch.mode.permissionMode as PermissionMode);
            this.applyDisplayMode(batch.mode.permissionMode as PermissionMode);

            this.lastUserMessage = batch.message;
            this.lastTurnMode = batch.mode;

            const specialCommand = parseCursorSpecialCommand(batch.message);
            if (specialCommand.type === 'pass-through') {
                messageBuffer.addMessage(cursorPassThroughStatusMessage(specialCommand.command), 'status');
            }
            messageBuffer.addMessage(batch.message, 'user');

            // skill_lookup discovery lives on the MCP tool description — do not
            // prepend instructions onto user turns (prompt-injection false positive).
            const promptContent: PromptContent[] = [{
                type: 'text',
                text: batch.message
            }];

            session.onThinkingChange(true);
            this.turnHasModelError = false;
            this.lastAssistantText = null;

            try {
                await backend.prompt(acpSessionId, promptContent, (message) => {
                    this.handleAgentMessage(message);
                });
                void backend.refreshSessionInfo(acpSessionId, session.path);
            } catch (error) {
                logger.warn('[cursor-acp] prompt failed', error);
                const errMsg = error instanceof Error ? error.message : String(error);
                const message = `Cursor Agent failed: ${errMsg}`;
                const converted = convertAgentMessage({ type: 'error', message });
                if (converted) {
                    session.sendAgentMessage(converted);
                }
                messageBuffer.addMessage(message, 'status');
                // STRUCTURAL signal: classify the RPC rejection. This catches
                // transport_closed (WritableIterable / ACP closed), agent_crashed
                // (process exit during prompt), rpc_timeout, and gRPC status
                // strings that cursor-agent returned as JSON-RPC error.message
                // (rather than stringifying as a text message). Returns null
                // for user cancellations / aborts -- those are NOT model errors.
                const failure = classifyAcpRpcRejection(error);
                if (failure) {
                    this.recordModelError(failure);
                }
            } finally {
                session.onThinkingChange(false);
                await this.permissionAdapter?.cancelAll('Prompt finished');
                await this.extensionAdapter?.cancelAll('Prompt finished');
                if (!this.turnHasModelError && this.bridgingForAtTs !== null) {
                    this.bridgingForAtTs = null;
                }
                if (session.queue.size() === 0 && !this.shouldExit) {
                    sendReady();
                }
            }
        }
    }

    protected async cleanup(): Promise<void> {
        // Capture overlay before awaited teardown so a reject from
        // cancelAll/disconnect cannot leave a dead hapi-* entry in .cursor/mcp.json.
        const overlay = this.cursorMcpOverlay;
        this.cursorMcpOverlay = null;

        try {
            this.clearAbortHandlers(this.session.client.rpcHandlerManager);
            this.session.client.rpcHandlerManager.registerHandler(
                RPC_METHODS.BridgeModelError,
                async () => ({ ok: false, reason: 'session_ended' })
            );
            this.unregisterModelApplyHandler?.();
            this.unregisterModelApplyHandler = null;

            if (this.permissionAdapter) {
                await this.permissionAdapter.cancelAll('Session ended');
                this.permissionAdapter = null;
            }

            if (this.extensionAdapter) {
                await this.extensionAdapter.cancelAll('Session ended');
                this.extensionAdapter = null;
            }

            if (this.backend) {
                await this.backend.disconnect();
                this.backend = null;
            }

            if (this.happyServer) {
                this.happyServer.stop();
                this.happyServer = null;
            }

            if (this.notifyRuleOverlay) {
                this.notifyRuleOverlay.cleanup();
                this.notifyRuleOverlay = null;
            }
        } finally {
            overlay?.cleanup();
            setCursorAcpModelsSnapshot(null);
        }
    }

    private wireStderrErrorListener(
        backend: AcpSdkBackend,
        onHint: (hint: string | null) => void
    ): void {
        const session = this.session;
        const messageBuffer = this.messageBuffer;
        backend.onStderrError((error: AcpStderrError) => {
            logger.debug('[cursor-acp] stderr error', error);
            const hint = error.raw || error.message;
            onHint(hint);
            if (error.type === 'model_not_found' && extractCannotUseThisModelMessage(hint)) {
                return;
            }
            const converted = convertAgentMessage({ type: 'error', message: error.message });
            if (converted) {
                session.sendAgentMessage(converted);
            }
            messageBuffer.addMessage(error.message, 'status');
            // STRUCTURAL signal: route typed stderr into modelError pipeline.
            this.recordModelError(mapAcpStderrToFailure(error));
        });
    }

    private handleCreatePlanAccepted(): void {
        const backend = this.backend;
        const acpSessionId = this.acpSessionId;
        if (!backend || !acpSessionId) {
            logger.warn('[cursor-acp] CreatePlan accepted but ACP session is not ready; skip continue handoff');
            return;
        }

        const session = this.session;
        const executeMode = resolveCursorModeAfterPlanApproval(
            session.getPermissionMode() as PermissionMode
        ) as PermissionMode;

        // Leave plan/ask for an executable mode, then queue a continue prompt so
        // Yes means "keep going on the user task" (Claude ExitPlanMode parallel).
        session.setPermissionMode(executeMode);
        void applyCursorAcpMode(backend, acpSessionId, executeMode).then(() => {
            this.applyDisplayMode(executeMode);
        });

        session.queue.unshiftIsolated(CURSOR_PLAN_CONTINUE, {
            permissionMode: executeMode,
            model: session.model
        });
        logger.debug('[cursor-acp] CreatePlan accepted — queued continue prompt', {
            executeMode
        });
    }

    private handleAgentMessage(message: AgentMessage): void {
        const converted = convertAgentMessage(message, this.currentBackendModel);
        if (converted) {
            this.session.sendAgentMessage(converted);
        }

        switch (message.type) {
            case 'text':
                this.messageBuffer.addMessage(message.text, 'assistant');
                this.handleTextMessageClassification(message.text);
                break;
            case 'reasoning':
                break;
            case 'usage':
                break;
            case 'tool_call':
                this.messageBuffer.addMessage(`Tool: ${message.name}`, 'tool');
                break;
            case 'tool_result':
                this.messageBuffer.addMessage('Tool result', 'result');
                break;
            case 'plan':
                this.messageBuffer.addMessage('Plan updated', 'status');
                break;
            case 'error':
                this.messageBuffer.addMessage(message.message, 'status');
                break;
            case 'generated_image':
                this.messageBuffer.addMessage(`Generated image: ${message.fileName}`, 'assistant');
                break;
            case 'turn_complete':
                break;
            default:
                break;
        }
    }

    private handleTextMessageClassification(text: string): void {
        // FALLBACK PATH ONLY. If a structural signal (stderr / RPC) already
        // classified this turn, do not re-classify the agent's text -- the
        // text is often the agent's own stringified version of the same
        // error we already caught structurally, and re-classifying produces
        // duplicate banners. We still record lastAssistantText so the
        // priorAssistantClaimsDone heuristic works for any subsequent
        // structural signal in this turn.
        if (this.turnHasModelError) {
            this.lastAssistantText = text;
            return;
        }
        const failure = classifyCursorAgentMessage(text);
        if (failure) {
            this.recordModelError(failure);
        } else {
            this.lastAssistantText = text;
        }
    }

    /**
     * Single source of truth for emitting modelError. All signal paths
     * (RPC catch / stderr subscriber / text fallback) route through here.
     * First signal wins: subsequent signals in the same turn are dropped
     * to avoid banner-flapping when the agent emits both an RPC rejection
     * AND a stringified text version of the same failure.
     */
    private recordModelError(failure: CursorAgentStreamFailure): void {
        if (this.turnHasModelError) {
            logger.debug(
                `[cursor-acp] modelError already recorded for this turn, dropping ${failure.source}/${failure.kind}`
            );
            return;
        }
        this.turnHasModelError = true;

        const bridgedFailure = this.bridgingForAtTs !== null;
        if (bridgedFailure) {
            this.bridgingForAtTs = null;
        }

        // Same-message case: Cursor often appends `Error: T: ...` onto the
        // assistant block that already claimed "Done." — lastAssistantText is
        // still null because we classify before storing. Check failure.raw too.
        const priorAssistantClaimsDone = (this.lastAssistantText !== null
            && isCompletionClaim(this.lastAssistantText))
            || (failure.source === 'text' && isCompletionClaim(failure.raw));
        const rawSnippet = failure.raw.slice(0, 400);
        const atTs = Date.now();
        const lastUserMessage = truncateLastUserMessage(this.lastUserMessage ?? '');

        logger.debug(
            `[cursor-acp] modelError recorded source=${failure.source} kind=${failure.kind} transient=${failure.transient}${bridgedFailure ? ' (bridge failed)' : ''}`
        );

        this.lastRecordedModelError = {
            atTs,
            kind: failure.kind,
            transient: failure.transient,
            rawSnippet,
            priorAssistantClaimsDone,
            lastUserMessage,
            ...(bridgedFailure ? { retriedAndFailed: true } : {})
        };

        this.session.client.updateMetadata((metadata) => ({
            ...metadata,
            lastModelError: this.lastRecordedModelError!
        }));

        this.session.sendSessionEvent({
            type: 'modelError',
            kind: failure.kind,
            transient: failure.transient,
            rawSnippet,
            priorAssistantClaimsDone
        });

        if (!bridgedFailure && failure.transient && getAutoBridgeTransientModelErrors()) {
            this.tryEnqueueModelErrorBridge('auto');
        }
    }

    private async handleBridgeModelErrorRpc(payload: unknown): Promise<{ ok: boolean; reason?: string }> {
        if (!payload || typeof payload !== 'object') {
            return this.tryEnqueueModelErrorBridge('manual');
        }

        const record = payload as Record<string, unknown>;
        const snapshot = {
            atTs: typeof record.atTs === 'number' ? record.atTs : undefined,
            kind: typeof record.kind === 'string' ? record.kind : undefined,
            rawSnippet: typeof record.rawSnippet === 'string' ? record.rawSnippet : undefined,
            lastUserMessage: typeof record.lastUserMessage === 'string' ? record.lastUserMessage : undefined,
            priorAssistantClaimsDone: record.priorAssistantClaimsDone === true,
            transient: typeof record.transient === 'boolean'
                ? record.transient
                : (this.lastRecordedModelError?.transient ?? false),
            bridgedForAtTs: typeof record.bridgedForAtTs === 'number' ? record.bridgedForAtTs : undefined,
            retriedAndFailed: record.retriedAndFailed === true
        };

        if (snapshot.atTs !== undefined) {
            this.lastRecordedModelError = {
                atTs: snapshot.atTs,
                kind: snapshot.kind ?? this.lastRecordedModelError?.kind ?? 'unknown',
                rawSnippet: snapshot.rawSnippet ?? this.lastRecordedModelError?.rawSnippet ?? '',
                priorAssistantClaimsDone: snapshot.priorAssistantClaimsDone,
                lastUserMessage: snapshot.lastUserMessage
                    ?? this.lastRecordedModelError?.lastUserMessage
                    ?? this.lastUserMessage
                    ?? '',
                transient: snapshot.transient,
                bridgedForAtTs: snapshot.bridgedForAtTs,
                retriedAndFailed: snapshot.retriedAndFailed
            };
        }

        return this.tryEnqueueModelErrorBridge('manual');
    }

    private tryEnqueueModelErrorBridge(source: 'auto' | 'manual'): { ok: boolean; reason?: string } {
        const metadataError = this.lastRecordedModelError;

        if (!metadataError) {
            return { ok: false, reason: 'no_model_error' };
        }

        const bridgeInput = {
            atTs: metadataError.atTs,
            kind: metadataError.kind,
            rawSnippet: metadataError.rawSnippet,
            priorAssistantClaimsDone: metadataError.priorAssistantClaimsDone,
            lastUserMessage: metadataError.lastUserMessage ?? this.lastUserMessage ?? ''
        };

        if (!bridgeInput.lastUserMessage.trim()) {
            return { ok: false, reason: 'missing_last_user_message' };
        }

        if (!canBridgeModelError({
            transient: metadataError.transient,
            atTs: metadataError.atTs,
            bridgedForAtTs: metadataError.bridgedForAtTs,
            retriedAndFailed: metadataError.retriedAndFailed
        })) {
            return { ok: false, reason: 'not_bridgeable' };
        }

        const prompt = buildModelErrorBridgePrompt({
            kind: bridgeInput.kind,
            rawSnippet: bridgeInput.rawSnippet,
            lastUserMessage: bridgeInput.lastUserMessage,
            priorAssistantClaimsDone: bridgeInput.priorAssistantClaimsDone
        });

        const bridgedAtTs = metadataError.atTs;
        this.bridgingForAtTs = bridgedAtTs;

        this.lastRecordedModelError = {
            ...metadataError,
            bridgedForAtTs: bridgedAtTs
        };

        this.session.client.updateMetadata((metadata) => {
            const current = metadata.lastModelError;
            const nextError = current?.atTs === bridgedAtTs
                ? {
                    ...current,
                    bridgedForAtTs: bridgedAtTs
                }
                : {
                    kind: metadataError.kind,
                    transient: metadataError.transient,
                    rawSnippet: metadataError.rawSnippet,
                    atTs: metadataError.atTs,
                    priorAssistantClaimsDone: metadataError.priorAssistantClaimsDone,
                    ...(metadataError.lastUserMessage
                        ? { lastUserMessage: metadataError.lastUserMessage }
                        : {}),
                    bridgedForAtTs: bridgedAtTs
                };

            return {
                ...metadata,
                lastModelError: nextError
            };
        });

        const mode = this.lastTurnMode ?? {
            permissionMode: this.session.getPermissionMode() as PermissionMode,
            model: this.currentBackendModel ?? this.session.model ?? undefined
        };

        this.session.queue.pushIsolated(prompt, mode);
        // Chat-visible recovery marker only. Not an AGENT_NOTIFY_SUMMARY — overseer/inbox
        // must not treat successful bridges as attention candidates.
        this.session.sendSessionEvent({
            type: 'modelErrorBridged',
            kind: metadataError.kind,
            auto: source === 'auto',
            atTs: bridgedAtTs
        });
        logger.debug(`[cursor-acp] modelError bridge enqueued for atTs=${bridgedAtTs} source=${source}`);

        return { ok: true };
    }

    private installLiveSessionConfigSync(
        backend: AcpSdkBackend,
        acpSessionId: string,
        previousSetModel: CursorSession['setModel']
    ): void {
        const session = this.session;
        const previousSetPermissionMode = session.setPermissionMode.bind(session);
        session.setPermissionMode = (mode: PermissionMode) => {
            previousSetPermissionMode(mode);
            void applyCursorAcpMode(backend, acpSessionId, mode).then(() => {
                this.applyDisplayMode(mode);
            });
            this.maybeQueueAutoReviewSlash(mode);
        };

        this.unregisterModelApplyHandler = session.registerModelApplyHandler(async (model) => (
            await this.applyLiveModel(backend, acpSessionId, model, previousSetModel, {
                optimistic: false,
                throwOnFailure: true
            })
        ));

        session.setModel = (model: string | null | undefined) => {
            void this.applyLiveModel(backend, acpSessionId, model, previousSetModel, {
                optimistic: true,
                throwOnFailure: false
            }).catch((error) => {
                logger.warn('[cursor-acp] Failed to apply model from session sync', error);
            });
        };
    }

    private async applyLiveModel(
        backend: AcpSdkBackend,
        acpSessionId: string,
        model: string | null | undefined,
        previousSetModel: CursorSession['setModel'],
        options: { optimistic: boolean; throwOnFailure: boolean }
    ): Promise<string | null> {
        const requested = model?.trim();
        const previousModel = this.currentBackendModel ?? this.session.model ?? null;
        const applySeq = ++this.modelApplySeq;

        if (!requested || isSpawnDefaultModel(requested)) {
            const modelOption = backend.getConfigOptionByCategory?.(acpSessionId, 'model');
            const defaultWire = modelOption?.options?.find(
                (option) => isSpawnDefaultModel(option.value)
            )?.value;
            if (modelOption && defaultWire && backend.setConfigOption) {
                try {
                    await backend.setConfigOption(acpSessionId, modelOption.id, defaultWire);
                    backend.pinSessionModelWireId(acpSessionId, defaultWire);
                } catch (error) {
                    logger.debug('[cursor-acp] Failed to set default model via ACP', error);
                    if (options.throwOnFailure) {
                        throw new Error('Cursor default model is not available via ACP');
                    }
                }
            } else if (options.throwOnFailure) {
                throw new Error('Cursor default model is not available via ACP');
            }
            this.currentBackendModel = null;
            previousSetModel(undefined);
            this.session.pushKeepAlive();
            syncCursorModelsFromAcp(backend, acpSessionId);
            return null;
        }

        if (options.optimistic) {
            const optimisticWire = wireIdForCursorSessionState(requested, requested);
            this.currentBackendModel = optimisticWire;
            previousSetModel(optimisticWire);
            this.session.pushKeepAlive();
        }

        const result = await applyCursorAcpModel(backend, acpSessionId, requested);
        if (!result.applied || !result.resolvedWireId) {
            const message = `Cursor model is not available via ACP: ${requested}`;
            logger.warn(`[cursor-acp] ${message}`);

            if (options.optimistic && applySeq === this.modelApplySeq) {
                this.currentBackendModel = previousModel;
                previousSetModel(previousModel ?? undefined);
                this.session.pushKeepAlive();
            } else if (!options.throwOnFailure && previousModel && !isSpawnDefaultModel(previousModel)) {
                this.currentBackendModel = previousModel;
                previousSetModel(previousModel);
                this.session.pushKeepAlive();
            }
            syncCursorModelsFromAcp(backend, acpSessionId);

            if (options.throwOnFailure) {
                throw new Error(message);
            }
            return previousModel;
        }

        const sessionWire = wireIdForCursorSessionState(
            result.requestedWireId ?? requested,
            result.resolvedWireId
        );

        if (applySeq !== this.modelApplySeq) {
            return this.currentBackendModel;
        }

        const changed = sessionWire !== this.currentBackendModel || this.session.model !== sessionWire;
        this.currentBackendModel = sessionWire;
        previousSetModel(sessionWire);
        if (changed) {
            this.pushModelStatusLine(sessionWire);
        }
        this.session.pushKeepAlive();
        syncCursorModelsFromAcp(backend, acpSessionId);
        return sessionWire;
    }

    private pushModelStatusLine(model: string | null | undefined): void {
        const trimmed = model?.trim();
        if (!trimmed || isSpawnDefaultModel(trimmed)) {
            this.messageBuffer.addMessage('[MODEL:auto]', 'system');
            return;
        }
        this.messageBuffer.addMessage(`[MODEL:${trimmed}]`, 'system');
    }

    private applyDisplayMode(permissionMode: PermissionMode | undefined): void {
        if (permissionMode && permissionMode !== this.displayPermissionMode) {
            this.displayPermissionMode = permissionMode;
            this.messageBuffer.addMessage(`[MODE:${permissionMode}]`, 'system');
        }
    }

    /**
     * Mid-session Auto-review: ACP has no config option, so when the process was
     * not spawned with `--auto-review`, queue an isolated `/auto-review` slash once.
     */
    private maybeQueueAutoReviewSlash(mode: PermissionMode): void {
        if (!isCursorAutoReviewMode(mode)) {
            return;
        }
        if (this.spawnedWithAutoReview || this.autoReviewSlashQueued) {
            return;
        }
        this.autoReviewSlashQueued = true;
        this.session.queue.pushIsolated(
            '/auto-review',
            {
                permissionMode: mode,
                model: this.session.model
            }
        );
        this.messageBuffer.addMessage(cursorPassThroughStatusMessage('auto-review'), 'status');
    }

    private recordCursorNativeWorktreeMetadata(): void {
        const worktree = this.session.cursorWorktree;
        if (worktree === undefined || worktree === false) {
            return;
        }
        const name = typeof worktree === 'string' ? worktree.trim() : '';
        if (!name) {
            this.messageBuffer.addMessage('Cursor native worktree enabled', 'status');
            return;
        }
        const worktreePath = resolveCursorNativeWorktreePath(this.session.path, name);
        this.session.client.updateMetadata((metadata) => ({
            ...metadata,
            worktree: {
                basePath: this.session.path,
                branch: name,
                name,
                worktreePath,
                createdAt: Date.now()
            }
        }));
        this.messageBuffer.addMessage(`Cursor worktree: ${worktreePath}`, 'status');
    }

    private async handleAbort(): Promise<void> {
        const backend = this.backend;
        const sessionId = this.session.sessionId;
        if (backend && sessionId) {
            await backend.cancelPrompt(sessionId);
        }
        await this.permissionAdapter?.cancelAll('User aborted');
        await this.extensionAdapter?.cancelAll('User aborted');
        this.session.queue.reset();
        this.session.onThinkingChange(false);
        this.abortController.abort();
        this.abortController = new AbortController();
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', () => this.handleAbort());
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }

    private async handleSwitchRequest(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }
}

const CANNOT_USE_THIS_MODEL_RE = /Cannot use this model:\s*.+/i;

/**
 * Operator-facing ACP failure text. Prefer Cursor's model-rejection stderr;
 * never invent a legacy stream-json diagnosis for unrelated failures.
 */
export function classifyCursorAcpLoadError(
    error: unknown,
    options?: { recentStderr?: string | null; action?: 'resume' | 'start' }
): string {
    const action = options?.action ?? 'resume';
    const prefix = action === 'start'
        ? 'Failed to start Cursor ACP session'
        : 'Failed to resume Cursor ACP session';

    const detailSources = [
        // Prefer the close Error (accumulated stderr) over live onStderrError hints,
        // which may have seen only the first fragment of a split rejection line.
        error instanceof Error ? error.message : null,
        error instanceof Error ? String((error as Error & { stderr?: unknown }).stderr ?? '') : null,
        error instanceof Error && error.cause instanceof Error ? error.cause.message : null,
        options?.recentStderr,
        typeof error === 'string' ? error : null
    ].filter((value): value is string => Boolean(value && value.trim()));

    for (const source of detailSources) {
        const modelRejection = extractCannotUseThisModelMessage(source);
        if (modelRejection) {
            return `${prefix}: ${modelRejection}`;
        }
    }

    const detail = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : String(error);
    const trimmed = detail.trim() || 'unknown error';
    if (new RegExp(`^${prefix}:`, 'i').test(trimmed)) {
        return trimmed;
    }
    return `${prefix}: ${trimmed}`;
}

function extractCannotUseThisModelMessage(text: string | null | undefined): string | null {
    if (!text) {
        return null;
    }
    const match = text.match(CANNOT_USE_THIS_MODEL_RE);
    if (!match) {
        return null;
    }
    // Keep Cursor's Available models hint when present; do not invent a catalog.
    return match[0].trim().replace(/\s+/g, ' ');
}

function formatAcpLoadError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        const record: Record<string, unknown> = {
            name: error.name,
            message: error.message
        };
        const code = (error as Error & { code?: unknown }).code;
        if (code !== undefined) {
            record.code = code;
        }
        const data = (error as Error & { data?: unknown }).data;
        if (data !== undefined) {
            record.data = data;
        }
        const stderr = (error as Error & { stderr?: unknown }).stderr;
        if (stderr !== undefined) {
            record.stderr = stderr;
        }
        const cause = error.cause;
        if (cause !== undefined) {
            record.cause = cause instanceof Error
                ? { name: cause.name, message: cause.message }
                : cause;
        }
        return record;
    }
    if (typeof error === 'object' && error !== null) {
        return { ...(error as Record<string, unknown>) };
    }
    return { message: String(error) };
}

function isSpawnDefaultModel(modelId: string): boolean {
    const normalized = modelId.trim().toLowerCase();
    return normalized === 'auto' || normalized === 'default' || normalized === 'default[]';
}

function syncCursorModelsFromAcp(backend: AcpSdkBackend, acpSessionId: string): void {
    const snapshot = buildCursorModelsSnapshotFromAcp(backend, acpSessionId);
    if (!snapshot) {
        return;
    }

    const payload = buildCursorModelsSeedPayload(snapshot, readSharedCursorModelsCache());
    setCursorAcpModelsSnapshot(snapshot);
    seedCursorModelsCache(payload);
}

export async function cursorAcpRemoteLauncher(session: CursorSession): Promise<'switch' | 'exit'> {
    const launcher = new CursorAcpRemoteLauncher(session);
    return launcher.launch();
}
