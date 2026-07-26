import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState } from '@/api/types';
import type { AcpSdkBackend } from '@/agent/backends/acp';
import { logger } from '@/ui/logger';
import { asString, isObject } from '@hapi/protocol';
import type { AgentMessage, PlanItem } from '@/agent/types';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
    detectImageMimeType,
    decodeGeneratedImageBase64,
    registerGeneratedImage,
    registerGeneratedImageFromPath,
} from '@/modules/common/generatedImages';
import { validatePath } from '@/modules/common/pathSecurity';

type PendingExtensionRequest = {
    tool: string;
    arguments: unknown;
    respond: (result: unknown) => void;
};

type PermissionResponseMessage = {
    id: string;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    answers?: Record<string, string[]>;
};

export type CursorExtensionMessageHandler = (message: AgentMessage) => void;

export type CursorExtensionAdapterOptions = {
    /** Session cwd; path-only generate_image must stay inside this tree. */
    workingDirectory?: string;
};

type GenerateImageOutcome =
    | { outcome: 'generated'; filePath: string; imageData?: string }
    | { outcome: 'rejected'; reason?: string }
    | { outcome: 'cancelled' };

export class CursorExtensionAdapter {
    private readonly pending = new Map<string, PendingExtensionRequest>();
    private readonly workingDirectory: string | undefined;

    constructor(
        private readonly session: ApiSessionClient,
        private readonly backend: AcpSdkBackend,
        private readonly onMessage: CursorExtensionMessageHandler,
        options?: CursorExtensionAdapterOptions,
    ) {
        this.workingDirectory = options?.workingDirectory;
        this.registerHandlers();
    }

    handlePermissionResponse = async (response: PermissionResponseMessage): Promise<boolean> => {
        if (!this.pending.has(response.id)) {
            return false;
        }
        await this.handleResponse(response);
        return true;
    };

    private registerHandlers(): void {
        this.backend.registerExtensionRequestHandler('cursor/ask_question', async (params) => {
            return await this.handleBlockingRequest('CursorAskQuestion', params);
        });

        this.backend.registerExtensionRequestHandler('cursor/create_plan', async (params) => {
            return await this.handleBlockingRequest('CursorCreatePlan', params);
        });

        // Docs: update_todos / task / generate_image are notifications (no JSON-RPC id).
        // Cursor may still send them as requests; register both paths.
        this.backend.registerExtensionRequestHandler('cursor/update_todos', async (params) => {
            this.handleTodoUpdate(params);
            return {};
        });
        this.backend.registerExtensionNotificationHandler('cursor/update_todos', (params) => {
            this.handleTodoUpdate(params);
        });

        this.backend.registerExtensionRequestHandler('cursor/task', async (params) => {
            this.handleTaskNotification(params);
            return {};
        });
        this.backend.registerExtensionNotificationHandler('cursor/task', (params) => {
            this.handleTaskNotification(params);
        });

        this.backend.registerExtensionRequestHandler('cursor/generate_image', async (params) => {
            return await this.handleGenerateImage(params);
        });
        this.backend.registerExtensionNotificationHandler('cursor/generate_image', (params) => {
            void this.handleGenerateImage(params).catch((error) => {
                logger.warn('[cursor-acp] cursor/generate_image notification failed', error);
            });
        });
    }

    private async handleBlockingRequest(tool: string, params: unknown): Promise<unknown> {
        const requestId = extractToolCallId(params) ?? `cursor-${randomUUID()}`;
        const args = isObject(params) ? params : { toolCallId: requestId };

        return await new Promise<unknown>((resolve) => {
            this.pending.set(requestId, {
                tool,
                arguments: args,
                respond: resolve
            });

            this.session.updateAgentState((currentState) => ({
                ...currentState,
                requests: {
                    ...currentState.requests,
                    [requestId]: {
                        tool,
                        arguments: args,
                        createdAt: Date.now()
                    }
                }
            } satisfies AgentState));

            logger.debug(`[cursor-acp] Extension request queued: ${tool} (${requestId})`);
        });
    }

    private async handleResponse(response: PermissionResponseMessage): Promise<void> {
        const pending = this.pending.get(response.id);
        if (!pending) {
            return;
        }

        this.pending.delete(response.id);

        const decision = response.decision ?? (response.approved ? 'approved' : 'denied');
        if (pending.tool === 'CursorAskQuestion') {
            if (decision === 'abort' || decision === 'denied') {
                pending.respond({ outcome: 'cancelled' });
            } else {
                pending.respond({
                    outcome: 'answered',
                    answers: formatQuestionAnswers(pending.arguments, response.answers)
                });
            }
        } else if (decision === 'abort') {
            pending.respond({ outcome: 'cancelled' });
        } else if (decision === 'denied') {
            pending.respond({ outcome: 'rejected' });
        } else {
            pending.respond({ outcome: 'accepted' });
        }

        const status = response.approved ? 'approved' : 'denied';
        this.session.updateAgentState((currentState) => {
            const requestEntry = currentState.requests?.[response.id];
            const { [response.id]: _, ...remaining } = currentState.requests ?? {};
            return {
                ...currentState,
                requests: remaining,
                completedRequests: {
                    ...currentState.completedRequests,
                    [response.id]: {
                        tool: pending.tool,
                        arguments: pending.arguments,
                        createdAt: requestEntry?.createdAt ?? Date.now(),
                        completedAt: Date.now(),
                        status,
                        decision
                    }
                }
            } satisfies AgentState;
        });
    }

    private handleTodoUpdate(params: unknown): void {
        if (!isObject(params)) return;
        const todos = Array.isArray(params.todos) ? params.todos : [];
        const items: PlanItem[] = [];
        for (const entry of todos) {
            if (!isObject(entry)) continue;
            const content = asString(entry.content) ?? asString(entry.title) ?? '';
            if (!content) continue;
            const status = normalizeTodoStatus(asString(entry.status));
            items.push({
                content,
                priority: 'medium',
                status
            });
        }
        if (items.length > 0) {
            this.onMessage({ type: 'plan', items });
        }
    }

    private handleTaskNotification(params: unknown): void {
        if (!isObject(params)) return;
        const toolCallId = extractToolCallId(params) ?? `cursor-task-${randomUUID()}`;
        const title = asString(params.title) ?? asString(params.description) ?? 'Cursor task';
        const status = normalizeTaskStatus(asString(params.status));
        this.onMessage({
            type: 'tool_call',
            id: toolCallId,
            name: 'CursorTask',
            input: { ...params, title },
            status
        });
        if (status === 'completed' || status === 'failed') {
            this.onMessage({
                type: 'tool_result',
                id: toolCallId,
                output: params,
                status
            });
        }
    }

    private async handleGenerateImage(params: unknown): Promise<GenerateImageOutcome> {
        if (!isObject(params)) {
            return { outcome: 'rejected', reason: 'invalid params' };
        }

        const toolCallId = extractToolCallId(params) ?? `cursor-image-${randomUUID()}`;
        const filePath = extractFilePath(params);
        const imageData = extractImageData(params);

        this.onMessage({
            type: 'tool_call',
            id: toolCallId,
            name: 'CursorGenerateImage',
            input: params,
            status: filePath && !imageData ? 'in_progress' : 'completed',
        });

        // Inline bytes are safe without a disk read / permission prompt.
        if (imageData) {
            const image = registerCursorGeneratedImageFromBase64(params, filePath, imageData);
            if (!image) {
                this.onMessage({
                    type: 'tool_call',
                    id: toolCallId,
                    name: 'CursorGenerateImage',
                    input: params,
                    status: 'failed',
                });
                this.onMessage({
                    type: 'tool_result',
                    id: toolCallId,
                    output: { error: 'invalid image data' },
                    status: 'failed',
                });
                return { outcome: 'rejected', reason: 'invalid image data' };
            }
            this.onMessage({
                type: 'generated_image',
                imageId: image.id,
                fileName: image.fileName,
                mimeType: image.mimeType,
            });
            this.onMessage({
                type: 'tool_result',
                id: toolCallId,
                output: params,
                status: 'completed',
            });
            return {
                outcome: 'generated',
                filePath: filePath ?? image.fileName,
            };
        }

        if (filePath) {
            if (this.workingDirectory) {
                const pathCheck = validatePath(filePath, this.workingDirectory);
                if (!pathCheck.valid) {
                    const reason = pathCheck.error ?? 'path outside working directory';
                    logger.warn(`[cursor-acp] generate_image path rejected: ${reason}`);
                    this.onMessage({
                        type: 'tool_call',
                        id: toolCallId,
                        name: 'CursorGenerateImage',
                        input: params,
                        status: 'failed',
                    });
                    this.onMessage({
                        type: 'tool_result',
                        id: toolCallId,
                        output: { error: reason },
                        status: 'failed',
                    });
                    return { outcome: 'rejected', reason };
                }
            }

            // Mirror display_image approval_mode: 'prompt' — never auto-read disk.
            const decision = await this.handleBlockingRequest('CursorGenerateImage', params);
            if (!isObject(decision)) {
                this.onMessage({
                    type: 'tool_call',
                    id: toolCallId,
                    name: 'CursorGenerateImage',
                    input: params,
                    status: 'failed',
                });
                this.onMessage({
                    type: 'tool_result',
                    id: toolCallId,
                    output: { error: 'invalid permission response' },
                    status: 'failed',
                });
                return { outcome: 'rejected', reason: 'invalid permission response' };
            }

            const outcome = asString(decision.outcome);
            if (outcome === 'cancelled') {
                this.onMessage({
                    type: 'tool_call',
                    id: toolCallId,
                    name: 'CursorGenerateImage',
                    input: params,
                    status: 'failed',
                });
                this.onMessage({
                    type: 'tool_result',
                    id: toolCallId,
                    output: { error: 'cancelled' },
                    status: 'failed',
                });
                return { outcome: 'cancelled' };
            }
            if (outcome !== 'accepted') {
                this.onMessage({
                    type: 'tool_call',
                    id: toolCallId,
                    name: 'CursorGenerateImage',
                    input: params,
                    status: 'failed',
                });
                this.onMessage({
                    type: 'tool_result',
                    id: toolCallId,
                    output: { error: 'user denied' },
                    status: 'failed',
                });
                return { outcome: 'rejected', reason: 'user denied' };
            }

            const image = await registerGeneratedImageFromPath({
                id: randomUUID(),
                path: filePath,
                fileName: basename(filePath),
            });
            if (!image) {
                this.onMessage({
                    type: 'tool_call',
                    id: toolCallId,
                    name: 'CursorGenerateImage',
                    input: params,
                    status: 'failed',
                });
                this.onMessage({
                    type: 'tool_result',
                    id: toolCallId,
                    output: { error: 'failed to read image' },
                    status: 'failed',
                });
                return { outcome: 'rejected', reason: 'failed to read image' };
            }

            this.onMessage({
                type: 'tool_call',
                id: toolCallId,
                name: 'CursorGenerateImage',
                input: params,
                status: 'completed',
            });
            this.onMessage({
                type: 'generated_image',
                imageId: image.id,
                fileName: image.fileName,
                mimeType: image.mimeType,
            });
            this.onMessage({
                type: 'tool_result',
                id: toolCallId,
                output: params,
                status: 'completed',
            });
            return { outcome: 'generated', filePath };
        }

        logger.debug('[cursor-acp] cursor/generate_image had no registrable image bytes/path', params);
        this.onMessage({
            type: 'tool_result',
            id: toolCallId,
            output: params,
            status: 'completed',
        });
        return { outcome: 'rejected', reason: 'no image data or file path' };
    }

    async cancelAll(reason: string): Promise<void> {
        const entries = Array.from(this.pending.entries());
        this.pending.clear();

        for (const [id, pending] of entries) {
            pending.respond(
                pending.tool === 'CursorAskQuestion'
                    ? { outcome: 'cancelled' }
                    : { outcome: 'cancelled' }
            );

            this.session.updateAgentState((currentState) => {
                const requestEntry = currentState.requests?.[id];
                const { [id]: _, ...remaining } = currentState.requests ?? {};
                return {
                    ...currentState,
                    requests: remaining,
                    completedRequests: {
                        ...currentState.completedRequests,
                        [id]: {
                            tool: pending.tool,
                            arguments: pending.arguments,
                            createdAt: requestEntry?.createdAt ?? Date.now(),
                            completedAt: Date.now(),
                            status: 'canceled',
                            reason,
                            decision: 'abort'
                        }
                    }
                } satisfies AgentState;
            });
        }
    }
}

function extractToolCallId(params: unknown): string | null {
    if (!isObject(params)) return null;
    return asString(params.toolCallId);
}

function extractFilePath(params: Record<string, unknown>): string | null {
    return asString(params.filePath)
        ?? asString(params.file_path)
        ?? asString(params.path)
        ?? asString(params.imagePath)
        ?? asString(params.image_path);
}

function extractImageData(params: Record<string, unknown>): string | null {
    return asString(params.imageData)
        ?? asString(params.image_data)
        ?? asString(params.data);
}

function registerCursorGeneratedImageFromBase64(
    params: Record<string, unknown>,
    filePath: string | null,
    imageData: string,
) {
    try {
        const bytes = decodeGeneratedImageBase64(imageData);
        if (!bytes) {
            return null;
        }
        const mimeType = detectImageMimeType(bytes);
        if (!mimeType) {
            return null;
        }
        const path = filePath ?? `${randomUUID()}.bin`;
        return registerGeneratedImage({
            id: randomUUID(),
            path,
            fileName: basename(path),
            mimeType,
            bytes,
        });
    } catch (error) {
        logger.debug('[cursor-acp] failed to register generate_image base64 payload', error);
        return null;
    }
}

function formatQuestionAnswers(
    params: unknown,
    answers: Record<string, string[]> | undefined
): Array<{ questionId: string; selectedOptionIds: string[] }> {
    if (!answers) return [];
    return Object.entries(answers).map(([questionId, selectedOptionIds]) => ({
        questionId,
        selectedOptionIds
    }));
}

function normalizeTodoStatus(status: string | null): PlanItem['status'] {
    if (status === 'in_progress' || status === 'completed' || status === 'pending') {
        return status;
    }
    return 'pending';
}

function normalizeTaskStatus(status: string | null): 'in_progress' | 'completed' | 'failed' {
    if (!status) {
        // Cursor often emits task notifications without an explicit status when done.
        return 'completed';
    }
    const normalized = status.trim().toLowerCase();
    if (normalized === 'running' || normalized === 'in_progress' || normalized === 'pending' || normalized === 'started') {
        return 'in_progress';
    }
    if (normalized === 'failed' || normalized === 'error' || normalized === 'cancelled' || normalized === 'canceled') {
        return 'failed';
    }
    return 'completed';
}
