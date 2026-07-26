import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState } from '@/api/types';
import type { AgentMessage } from '@/agent/types';
import type { AcpSdkBackend } from '@/agent/backends/acp';
import { clearGeneratedImages, getGeneratedImage } from '@/modules/common/generatedImages';
import { CursorExtensionAdapter } from './cursorExtensionAdapter';

type ExtensionHandler = (params: unknown, requestId: string | number | null) => Promise<unknown>;
type NotificationHandler = (params: unknown) => void | Promise<void>;

function createHarness(options?: { workingDirectory?: string }) {
    const handlers = new Map<string, ExtensionHandler>();
    const notificationHandlers = new Map<string, NotificationHandler>();
    let agentState: AgentState = { requests: {}, completedRequests: {} };
    const messages: AgentMessage[] = [];

    const session = {
        updateAgentState(handler: (state: AgentState) => AgentState) {
            agentState = handler(agentState);
        }
    } as unknown as ApiSessionClient;

    const backend = {
        registerExtensionRequestHandler(method: string, handler: ExtensionHandler) {
            handlers.set(method, handler);
        },
        registerExtensionNotificationHandler(method: string, handler: NotificationHandler) {
            notificationHandlers.set(method, handler);
        }
    } as unknown as AcpSdkBackend;

    const adapter = new CursorExtensionAdapter(session, backend, (message) => {
        messages.push(message);
    }, options);

    return {
        handlers,
        notificationHandlers,
        adapter,
        getAgentState: () => agentState,
        getMessages: () => messages
    };
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('CursorExtensionAdapter', () => {
    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        clearGeneratedImages();
    });

    afterEach(() => {
        clearGeneratedImages();
        vi.restoreAllMocks();
    });

    it('queues cursor/ask_question as CursorAskQuestion pending request', async () => {
        const { handlers, getAgentState } = createHarness();
        const handler = handlers.get('cursor/ask_question');
        expect(handler).toBeTypeOf('function');

        const pending = handler!({
            toolCallId: 'q-1',
            questions: [{ id: 'q1', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }] }]
        }, null);

        expect(getAgentState().requests).toMatchObject({
            'q-1': {
                tool: 'CursorAskQuestion',
                createdAt: 1_700_000_000_000
            }
        });

        void pending;
    });

    it('resolves ask_question with answered outcome and formatted answers', async () => {
        const { handlers, adapter } = createHarness();
        const pending = handlers.get('cursor/ask_question')!({
            toolCallId: 'q-1',
            questions: []
        }, null);

        const handled = await adapter.handlePermissionResponse({
            id: 'q-1',
            approved: true,
            answers: { q1: ['opt-a'] }
        });
        expect(handled).toBe(true);
        await expect(pending).resolves.toEqual({
            outcome: 'answered',
            answers: [{ questionId: 'q1', selectedOptionIds: ['opt-a'] }]
        });
    });

    it('resolves ask_question denial as cancelled', async () => {
        const { handlers, adapter } = createHarness();
        const pending = handlers.get('cursor/ask_question')!({ toolCallId: 'q-2' }, null);

        await adapter.handlePermissionResponse({
            id: 'q-2',
            approved: false,
            decision: 'denied'
        });

        await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
    });

    it('resolves create_plan approval as accepted', async () => {
        const { handlers, adapter } = createHarness();
        const pending = handlers.get('cursor/create_plan')!({
            toolCallId: 'plan-1',
            plan: '# Plan'
        }, null);

        await adapter.handlePermissionResponse({
            id: 'plan-1',
            approved: true,
            decision: 'approved'
        });

        await expect(pending).resolves.toEqual({ outcome: 'accepted' });
    });

    it('resolves create_plan denial as rejected', async () => {
        const { handlers, adapter } = createHarness();
        const pending = handlers.get('cursor/create_plan')!({ toolCallId: 'plan-2' }, null);

        await adapter.handlePermissionResponse({
            id: 'plan-2',
            approved: false,
            decision: 'denied'
        });

        await expect(pending).resolves.toEqual({ outcome: 'rejected' });
    });

    it('returns false from handlePermissionResponse for unrelated permission ids', async () => {
        const { adapter } = createHarness();
        const handled = await adapter.handlePermissionResponse({
            id: 'perm-read',
            approved: true
        });
        expect(handled).toBe(false);
    });

    it('maps cursor/update_todos to plan agent messages', async () => {
        const { handlers, getMessages } = createHarness();
        await handlers.get('cursor/update_todos')!({
            todos: [
                { content: 'Step one', status: 'in_progress' },
                { content: 'Step two', status: 'completed' }
            ]
        }, null);

        expect(getMessages()).toEqual([
            {
                type: 'plan',
                items: [
                    { content: 'Step one', priority: 'medium', status: 'in_progress' },
                    { content: 'Step two', priority: 'medium', status: 'completed' }
                ]
            }
        ]);
    });

    it('routes cursor/update_todos notifications without a JSON-RPC id', async () => {
        const { notificationHandlers, getMessages } = createHarness();
        const handler = notificationHandlers.get('cursor/update_todos');
        expect(handler).toBeTypeOf('function');

        await handler!({
            todos: [{ content: 'From notification', status: 'pending' }]
        });

        expect(getMessages()).toEqual([
            {
                type: 'plan',
                items: [{ content: 'From notification', priority: 'medium', status: 'pending' }]
            }
        ]);
    });

    it('emits CursorTask tool call and result for cursor/task', async () => {
        const { handlers, getMessages } = createHarness();
        await handlers.get('cursor/task')!({
            toolCallId: 'task-1',
            title: 'Run tests'
        }, null);

        expect(getMessages()).toEqual([
            expect.objectContaining({
                type: 'tool_call',
                id: 'task-1',
                name: 'CursorTask',
                status: 'completed'
            }),
            expect.objectContaining({
                type: 'tool_result',
                id: 'task-1',
                status: 'completed'
            })
        ]);
    });

    it('routes cursor/task notifications without a JSON-RPC id', async () => {
        const { notificationHandlers, getMessages } = createHarness();
        await notificationHandlers.get('cursor/task')!({
            toolCallId: 'task-notify',
            title: 'Notify task'
        });

        expect(getMessages()).toEqual([
            expect.objectContaining({
                type: 'tool_call',
                id: 'task-notify',
                name: 'CursorTask',
                status: 'completed'
            }),
            expect.objectContaining({
                type: 'tool_result',
                id: 'task-notify',
                status: 'completed'
            })
        ]);
    });

    it('keeps CursorTask running when status is in_progress', async () => {
        const { handlers, getMessages } = createHarness();
        await handlers.get('cursor/task')!({
            toolCallId: 'task-2',
            title: 'Subagent',
            status: 'in_progress'
        }, null);

        expect(getMessages()).toEqual([
            expect.objectContaining({
                type: 'tool_call',
                id: 'task-2',
                name: 'CursorTask',
                status: 'in_progress'
            })
        ]);
    });

    it('registers cursor/generate_image base64 imageData and returns structured outcome', async () => {
        const { handlers, getMessages } = createHarness();
        const result = await handlers.get('cursor/generate_image')!({
            toolCallId: 'img-1',
            description: 'App icon',
            filePath: '/tmp/icon.png',
            imageData: PNG_HEADER.toString('base64'),
        }, 'req-1');

        expect(result).toEqual({
            outcome: 'generated',
            filePath: '/tmp/icon.png',
        });

        const messages = getMessages();
        expect(messages[0]).toMatchObject({
            type: 'tool_call',
            id: 'img-1',
            name: 'CursorGenerateImage',
            status: 'completed',
        });
        expect(messages[1]).toMatchObject({
            type: 'generated_image',
            fileName: 'icon.png',
            mimeType: 'image/png',
        });
        expect(messages[2]).toMatchObject({
            type: 'tool_result',
            id: 'img-1',
            status: 'completed',
        });

        const generated = messages[1];
        expect(generated.type).toBe('generated_image');
        if (generated.type === 'generated_image') {
            expect(getGeneratedImage(generated.imageId)?.mimeType).toBe('image/png');
        }
    });

    it('rejects oversized generate_image base64 before decoding', async () => {
        const { handlers, getMessages } = createHarness();
        const result = await handlers.get('cursor/generate_image')!({
            toolCallId: 'img-huge',
            description: 'Too big',
            imageData: 'A'.repeat(40 * 1024 * 1024),
        }, null);

        expect(result).toMatchObject({ outcome: 'rejected' });
        expect(getMessages().some((m) => m.type === 'generated_image')).toBe(false);
    });

    it('routes cursor/generate_image notifications with base64 imageData', async () => {
        const { notificationHandlers, getMessages } = createHarness();
        await notificationHandlers.get('cursor/generate_image')!({
            toolCallId: 'img-notify',
            description: 'Notify icon',
            imageData: PNG_HEADER.toString('base64'),
        });

        expect(getMessages().some((m) => m.type === 'generated_image')).toBe(true);
    });

    it('permission-gates filePath-only generate_image before reading disk', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-cursor-gen-img-'));
        try {
            const filePath = join(dir, 'secret.png');
            writeFileSync(filePath, PNG_HEADER);

            const { handlers, adapter, getMessages, getAgentState } = createHarness({
                workingDirectory: dir,
            });
            const pending = handlers.get('cursor/generate_image')!({
                toolCallId: 'img-path',
                description: 'Must prompt before disk read',
                filePath,
            }, null);

            expect(getAgentState().requests).toMatchObject({
                'img-path': { tool: 'CursorGenerateImage' },
            });
            expect(getMessages().some((m) => m.type === 'generated_image')).toBe(false);

            await adapter.handlePermissionResponse({
                id: 'img-path',
                approved: true,
                decision: 'approved',
            });

            await expect(pending).resolves.toEqual({
                outcome: 'generated',
                filePath,
            });
            expect(getMessages().some((m) => m.type === 'generated_image')).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects filePath outside working directory without reading', async () => {
        const allowed = mkdtempSync(join(tmpdir(), 'hapi-cursor-cwd-'));
        const outside = mkdtempSync(join(tmpdir(), 'hapi-cursor-outside-'));
        try {
            const filePath = join(outside, 'leak.png');
            writeFileSync(filePath, PNG_HEADER);

            const { handlers, getMessages } = createHarness({ workingDirectory: allowed });
            const result = await handlers.get('cursor/generate_image')!({
                toolCallId: 'img-outside',
                description: 'Outside cwd',
                filePath,
            }, null);

            expect(result).toMatchObject({
                outcome: 'rejected',
                reason: expect.stringMatching(/working directory/i),
            });
            expect(getMessages().some((m) => m.type === 'generated_image')).toBe(false);
        } finally {
            rmSync(allowed, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });

    it('returns rejected when path-only generate_image is denied', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-cursor-deny-'));
        try {
            const filePath = join(dir, 'icon.png');
            writeFileSync(filePath, PNG_HEADER);

            const { handlers, adapter, getMessages } = createHarness({ workingDirectory: dir });
            const pending = handlers.get('cursor/generate_image')!({
                toolCallId: 'img-deny',
                description: 'Denied path',
                filePath,
            }, null);

            await adapter.handlePermissionResponse({
                id: 'img-deny',
                approved: false,
                decision: 'denied',
            });

            await expect(pending).resolves.toEqual({
                outcome: 'rejected',
                reason: 'user denied',
            });
            expect(getMessages().some((m) => m.type === 'generated_image')).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('still emits tool_call/result when generate_image has no path or bytes', async () => {
        const { handlers, getMessages } = createHarness();
        const result = await handlers.get('cursor/generate_image')!({
            toolCallId: 'img-3',
            description: 'No media yet',
        }, null);

        expect(result).toMatchObject({ outcome: 'rejected' });
        expect(getMessages().map((m) => m.type)).toEqual(['tool_call', 'tool_result']);
    });

    it('cancelAll resolves pending extension requests as cancelled', async () => {
        const { handlers, adapter, getAgentState } = createHarness();
        const askPending = handlers.get('cursor/ask_question')!({ toolCallId: 'q-cancel' }, null);
        const planPending = handlers.get('cursor/create_plan')!({ toolCallId: 'p-cancel' }, null);

        await adapter.cancelAll('User aborted');

        await expect(askPending).resolves.toEqual({ outcome: 'cancelled' });
        await expect(planPending).resolves.toEqual({ outcome: 'cancelled' });
        expect(getAgentState().requests).toEqual({});
        expect(getAgentState().completedRequests).toMatchObject({
            'q-cancel': { status: 'canceled', decision: 'abort' },
            'p-cancel': { status: 'canceled', decision: 'abort' }
        });
    });
});
