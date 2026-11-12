import { describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import { SharedCodexProjection, inputText } from './projection';
import { codexPlanProposalId } from './plan';
import { extractNotifySummary } from '@hapi/protocol/messages';

describe('shared history projection', () => {
    it.each([undefined, 'root'])('publishes only final summaries in live output and history replay (parent: %s)', async parentThreadId => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parentThreadId);
        const footer = 'AGENT_NOTIFY_SUMMARY {"status":"done","summary":"Finished"}';
        const items = [
            { id: 'progress', type: 'agentMessage', phase: 'commentary', text: `Still working.\n${footer}` },
            { id: 'partial', type: 'agentMessage', phase: 'partial_answer', text: `More work.\n${footer}` },
            { id: 'footer-only', type: 'agentMessage', phase: 'commentary', text: footer },
            { id: 'final', type: 'agentMessage', phase: 'final_answer', text: `Finished.\n${footer}` }
        ];
        for (const item of items) {
            await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item });
        }
        const live = send.mock.calls.slice();
        const bodies = live.map(([body]) => parentThreadId ? body.message : body);
        expect(bodies.map(body => body.message)).toEqual(['Still working.', 'More work.', `Finished.\n${footer}`]);
        expect(bodies.filter(body => extractNotifySummary(body.message))).toHaveLength(1);
        projection.reset(); send.mockClear();
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items }] });
        expect(send.mock.calls).toEqual(live);
    });

    it('keeps plan cards distinct across native turns and stable within each turn', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        for (const turnId of ['first', 'second']) {
            for (const status of ['pending', 'completed']) {
                await projection.notification('turn/plan/updated', { threadId: 'thread', turnId,
                    plan: [{ step: 'work', status }] });
            }
        }
        for (const type of ['tool-call', 'tool-call-result']) {
            expect(send.mock.calls.map(([body]) => body).filter(body => body.type === type).map(body => body.callId)).toEqual([
                'codex-plan-state:first', 'codex-plan-state:first',
                'codex-plan-state:second', 'codex-plan-state:second'
            ]);
        }
    });

    it.each([undefined, 'root'])('persists proposals without approval and replays the same IDs (parent: %s)', async parentThreadId => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parentThreadId);
        const item = { id: 'plan', type: 'plan', text: '# Final plan' };
        const params = { threadId: 'thread', turnId: 'turn', item };
        await projection.notification('item/completed', { ...params, item: { id: 'before', type: 'agentMessage', text: 'Preface' } });
        await projection.notification('item/started', params);
        await projection.notification('item/plan/delta', { ...params, itemId: 'plan', delta: '# Provisional' });
        await projection.notification('item/completed', params);
        await projection.notification('item/completed', params);
        await projection.notification('item/completed', { ...params, item: { id: 'after', type: 'agentMessage', text: 'Postscript' } });
        expect(send).toHaveBeenCalledTimes(4);
        const bodies = send.mock.calls.map(([body]) => parentThreadId ? body.message : body);
        const callId = codexPlanProposalId('thread', 'turn', 'plan');
        expect(bodies).toEqual([
            expect.objectContaining({ type: 'message', message: 'Preface' }),
            expect.objectContaining({ type: 'tool-call', name: 'ExitPlanMode', callId, input: { plan: '# Final plan' } }),
            expect.objectContaining({ type: 'tool-call-result', callId, output: null }),
            expect.objectContaining({ type: 'message', message: 'Postscript' })
        ]);
        const original = send.mock.calls.slice(1, 3);
        projection.reset(); send.mockClear();
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items: [item] }] });
        expect(send.mock.calls).toEqual(original);
    });

    it('waits for final proposal content after an active snapshot', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'plan', type: 'plan', text: 'partial' }] }] });
        expect(send).not.toHaveBeenCalled();
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item: { id: 'plan', type: 'plan', text: 'final' } });
        expect(send.mock.calls[0][0]).toMatchObject({ input: { plan: 'final' } });
        expect(send.mock.calls[1][0]).toMatchObject({ output: null });
    });

    it.each([undefined, 'root'])('emits canonical error flags for tools (parent: %s)', async parentThreadId => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parentThreadId);
        for (const failed of [true, false]) {
            for (const type of ['mcpToolCall', 'collabAgentToolCall']) {
                const item = { id: `${type}-${failed}`, type, server: 'test', tool: 'spawnAgent',
                    status: failed ? 'failed' : 'completed', error: failed ? { message: 'failed' } : null,
                    result: { Ok: 'done' } };
                await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item });
                const body = send.mock.lastCall?.[0];
                const result = parentThreadId ? body.message : body;
                expect(result).toMatchObject({ type: 'tool-call-result', is_error: failed });
                expect(result).not.toHaveProperty('isError');
            }
        }
    });
    it('persists a live duration once and never times history snapshots', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'old', status: 'completed', items: [{ id: 'old-answer', type: 'agentMessage', text: 'history' }] }] });
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'old', status: 'completed' } }, undefined, 5000);
        await projection.history({ turns: [{ id: 'already-running', status: 'inProgress', items: [] }] });
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'already-running', status: 'completed' } }, undefined, 6000);
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([]);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'live' } }, undefined, 10_000);
        projection.reset();
        await projection.history({ turns: [{ id: 'live', status: 'inProgress', items: [] }] });
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'old', status: 'completed' } }, undefined, 15_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'live', status: 'completed' } }, undefined, 49_426);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'live', status: 'completed' } }, undefined, 50_000);
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ durationMs: 39_426, turn_id: 'live' })
        ]);
    });

    it('fills the live turn duration with generation time and round output tokens', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        // Pre-round cumulative usage: the token baseline for the round.
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 1_000 } }
        }, undefined, 500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        await projection.notification('item/started', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', command: 'ls', startedAtMs: 2_000 }
        }, undefined, 2_050);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 1_050 } }
        }, undefined, 3_000);
        await projection.notification('item/completed', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', status: 'completed', durationMs: 1_800, completedAtMs: 4_000 }
        }, undefined, 4_050);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 5_000);

        const durations = send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration');
        // 4 s round, Codex-measured 1.8 s command: 2.2 s of generation for 50 tokens.
        expect(durations).toEqual([expect.objectContaining({
            turn_id: 'turn', durationMs: 4_000, generationMs: 2_200, generationOutputTokens: 50
        })]);
    });

    it('omits the generation pair without a pre-turn usage baseline', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        await projection.notification('item/started', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', command: 'ls' }
        }, undefined, 1_100);
        await projection.notification('item/completed', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', status: 'completed' }
        }, undefined, 2_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 3_000);

        const durations = send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration');
        expect(durations).toEqual([expect.objectContaining({ turn_id: 'turn', durationMs: 2_000 })]);
        expect(durations[0]).not.toHaveProperty('generationMs');
        expect(durations[0]).not.toHaveProperty('generationOutputTokens');
    });

    it('fills the generation pair for a fresh thread whose usage arrives mid-turn', async () => {
        // Mirrors the captured 2026-11-11 16:40 E2E rollout: a new thread's
        // first tokenUsage notifications land between turn/started and
        // turn/completed (wire shape per codex rust-v0.167.0
        // ThreadTokenUsageUpdatedNotification: camelCase breakdowns). The
        // CLI seeds a thread it created in this process to zero right after
        // thread/start; resumed or forked threads instead receive the
        // app-server's attach-time usage replay.
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        projection.seedFreshUsage();
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { outputTokens: 50 } }
        }, undefined, 2_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { outputTokens: 63 } }
        }, undefined, 4_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 5_000);

        const durations = send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration');
        expect(durations).toEqual([expect.objectContaining({
            turn_id: 'turn', durationMs: 4_000, generationMs: 4_000, generationOutputTokens: 63
        })]);
    });

    it('preserves the active generation ledger across a hub-only reconnect reset', async () => {
        // The hub reconnect replays history with stable IDs, but the native
        // turn keeps running without a new turn/started: the active round's
        // identity, baseline and windows must survive the reset.
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 100 } }
        }, undefined, 500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        projection.resetAfterHubReconnect();
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 160 } }
        }, undefined, 3_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 4_000);
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ durationMs: 3_000, generationMs: 3_000, generationOutputTokens: 60 })
        ]);
    });

    it('does not let mid-turn usage stand in for a baseline on a resumed thread', async () => {
        // Cold reopen path: a new app-server process resumes with
        // excludeTurns, so no usage replay arrives (codex rust-v0.167.0
        // thread_processor.rs skips the replay for excludeTurns resumes).
        // The session's token state is still seeded from the rollout, so the
        // first mid-turn cumulative total already includes inherited
        // history: counting it as this turn's output would overstate tok/s.
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { outputTokens: 47_000 } }
        }, undefined, 2_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { outputTokens: 47_060 } }
        }, undefined, 4_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 5_000);

        const durations = send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration');
        expect(durations).toEqual([expect.objectContaining({ turn_id: 'turn', durationMs: 4_000 })]);
        expect(durations[0]).not.toHaveProperty('generationMs');
        expect(durations[0]).not.toHaveProperty('generationOutputTokens');
    });

    it('does not let history replay feed the generation ledger', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({
            turns: [{ id: 'old', status: 'completed', items: [{
                id: 'cmd', type: 'commandExecution', command: 'long', startedAtMs: 100, completedAtMs: 900, durationMs: 800
            }] }]
        });
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 100 } }
        }, undefined, 2_000);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'live' } }, undefined, 3_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 160 } }
        }, undefined, 3_500);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'live', status: 'completed' } }, undefined, 4_000);

        // Replayed tool windows must not shrink the live round's generation time.
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ durationMs: 1_000, generationMs: 1_000, generationOutputTokens: 60 })
        ]);
    });

    it('resets the generation ledger when a turn fails and measures the next one', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 100 } }
        }, undefined, 500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'a' } }, undefined, 1_000);
        await projection.notification('item/started', {
            threadId: 'thread', turnId: 'a', item: { id: 'cmd', type: 'commandExecution', command: 'ls' }
        }, undefined, 1_100);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'a', status: 'failed' } }, undefined, 2_000);
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([]);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 160 } }
        }, undefined, 2_500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'b' } }, undefined, 3_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 260 } }
        }, undefined, 3_500);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'b', status: 'completed' } }, undefined, 4_000);

        // The failed turn's open tool window must not exclude time from turn b.
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ turn_id: 'b', durationMs: 1_000, generationMs: 1_000, generationOutputTokens: 100 })
        ]);
    });

    it('resets the generation ledger when the projection resets on reconnect', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 100 } }
        }, undefined, 500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        await projection.notification('item/started', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', command: 'ls', startedAtMs: 2_000 }
        }, undefined, 2_050);
        await projection.notification('item/completed', {
            threadId: 'thread', turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', status: 'completed', completedAtMs: 3_000 }
        }, undefined, 3_050);
        // App-server reconnect: the root resets the projection; the ledger must
        // drop the pre-disconnect round so the resumed turn re-measures itself.
        projection.reset();
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 20_000);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 160 } }
        }, undefined, 20_500);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 21_000);

        // The round wall clock keeps the upstream stale-start behavior (20000),
        // but generation time must be measured from the resume, not the
        // pre-disconnect start, and the stale tool window must not subtract.
        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ durationMs: 20_000, generationMs: 1_000, generationOutputTokens: 60 })
        ]);
    });

    it('times an approval wait into the live round through the host hook', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 0 } }
        }, undefined, 500);
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'turn' } }, undefined, 1_000);
        const answered = projection.beginUserWait(2_000);
        answered(3_500);
        await projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', tokenUsage: { total: { output_tokens: 10 } }
        }, undefined, 4_000);
        await projection.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } }, undefined, 5_000);

        expect(send.mock.calls.map(([body]) => body).filter(body => body.type === 'turn_duration')).toEqual([
            expect.objectContaining({ durationMs: 4_000, generationMs: 2_500, generationOutputTokens: 10 })
        ]);
    });

    it('keeps each turn model through settings changes, reconnect replay and rerouting', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'old' } }, 'model-a');
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'new' } }, 'model-b');
        projection.reset();
        // A replayed start must not rewrite the executing model either.
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'old' } }, 'model-b');
        const usage = async (turnId: string) => projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', turnId, tokenUsage: { last: { inputTokens: 12, outputTokens: 3 } }
        }, 'model-b');
        await usage('old');
        await projection.notification('model/rerouted', { threadId: 'thread', turnId: 'new', fromModel: 'model-b', toModel: 'model-c', reason: 'test' });
        await usage('new');
        const events = send.mock.calls.map(([body]) => body).filter(body => body.type === 'token_count');
        expect(events.map(body => body.model)).toEqual(['model-a', 'model-c']);
    });
    it('keeps image-only native inputs visible without embedding data URLs', () => {
        expect(inputText([{ type: 'image', url: 'data:image/png;base64,large' }])).toBe('[Image]');
        expect(inputText([{ type: 'localImage', path: '/tmp/image.png' }])).toBe('[Image: /tmp/image.png]');
    });
    it('replays after hub reconnect using the same durable local id', async () => {
        const send = vi.fn(); const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const snapshot = { turns: [{ id: 'turn', status: 'completed', items: [{ id: 'item', type: 'agentMessage', text: 'complete' }] }] };
        await projection.history(snapshot); projection.reset(); await projection.history(snapshot);
        expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    });
    it('does not settle an active snapshot under the final message id', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'item', type: 'agentMessage', text: 'partial' }] }] });
        expect(send).not.toHaveBeenCalled();
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item: { id: 'item', type: 'agentMessage', text: 'complete' } });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', message: 'complete' }), expect.any(String));
    });
    it('routes descendant answers into a scoped agent trace, not a root message', async () => {
        const send = vi.fn(); const user = vi.fn(); const committed = vi.fn(async () => {});
        const session = { getMetadata: () => ({}), sendAgentMessage: send, sendUserMessage: user } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'child', committed, 'root');
        await projection.notification('item/completed', { threadId: 'child', turnId: 'turn', item: { id: 'item', type: 'agentMessage', text: 'child answer' } });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent-run-trace', agentId: 'child', message: expect.objectContaining({ message: 'child answer' }) }), expect.any(String));
        await projection.notification('item/completed', { threadId: 'child', turnId: 'turn', item: { id: 'prompt', type: 'userMessage', content: [{ type: 'text', text: 'child prompt' }], clientId: 'cid' } });
        expect(user).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
    });

    it('announces parent compaction start via session event, deduping repeats', async () => {
        const send = vi.fn(); const sendEvent = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send, sendSessionEvent: sendEvent } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const params = { threadId: 'thread', turnId: 'turn', item: { id: 'c1', type: 'contextCompaction' } };
        await projection.notification('item/started', params);
        await projection.notification('item/started', params);
        await projection.notification('item/started', { threadId: 'thread', turnId: 'turn', item: { id: 'c2', type: 'contextCompaction' } });
        expect(send).not.toHaveBeenCalled();
        expect(sendEvent.mock.calls).toEqual([
            [{ type: 'message', message: '📦 Compaction started' }],
            [{ type: 'message', message: '📦 Compaction started' }]
        ]);
    });
    it('keeps child compaction start as trace with statusText, never a parent status', async () => {
        const send = vi.fn(); const sendEvent = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send, sendSessionEvent: sendEvent } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'child', async () => {}, 'root');
        await projection.notification('item/started', { threadId: 'child', turnId: 'turn', item: { id: 'c1', type: 'contextCompaction' } });
        expect(sendEvent).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledTimes(1);
        const [body] = send.mock.calls[0];
        expect(body.type).toBe('agent-run-trace');
        expect(body.message.type).toBe('compaction_started');
        expect(body.message.statusText).toBe('📦 Compaction started');
    });
    it('emits live compaction start but not for completed history replay', async () => {
        const send = vi.fn(); const sendEvent = vi.fn();
        const session = { getMetadata: () => ({}), sendAgentMessage: send, sendSessionEvent: sendEvent } as unknown as ApiSessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'turn', status: 'completed',
            items: [{ id: 'c1', type: 'contextCompaction' }] }] });
        expect(sendEvent).not.toHaveBeenCalled();
        expect(send.mock.calls.map(([b]) => b).some((b) => b.message === '📦 Compaction started')).toBe(false);
        expect(send.mock.calls.map(([b]) => b)).toContainEqual(expect.objectContaining({ type: 'context_compacted' }));
        send.mockClear();
        await projection.notification('item/started', { threadId: 'thread', turnId: 'live', item: { id: 'c9', type: 'contextCompaction' } });
        expect(send).not.toHaveBeenCalled();
        expect(sendEvent).toHaveBeenCalledWith({ type: 'message', message: '📦 Compaction started' });
    });
});
