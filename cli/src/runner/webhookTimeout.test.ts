import { describe, expect, it } from 'vitest';
import {
    SESSION_START_TIMEOUT_MS_DEFAULT,
    SESSION_START_TIMEOUT_MS_MAX,
    SESSION_START_TIMEOUT_MS_MIN
} from '@hapi/protocol/sessionStartTimeout';
import { formatTimeoutForMessage, resolveWebhookTimeoutMs, webhookTimeoutHint } from './webhookTimeout';

describe('resolveWebhookTimeoutMs', () => {
    it('defaults to 15s when nothing is configured', () => {
        expect(resolveWebhookTimeoutMs()).toBe(SESSION_START_TIMEOUT_MS_DEFAULT);
        expect(resolveWebhookTimeoutMs({ env: undefined, requestedMs: undefined })).toBe(SESSION_START_TIMEOUT_MS_DEFAULT);
    });

    it('uses the hub-configured value when there is no env override', () => {
        expect(resolveWebhookTimeoutMs({ requestedMs: 60_000 })).toBe(60_000);
    });

    it('clamps the hub-configured value into the supported range', () => {
        expect(resolveWebhookTimeoutMs({ requestedMs: 10 })).toBe(SESSION_START_TIMEOUT_MS_MIN);
        expect(resolveWebhookTimeoutMs({ requestedMs: 24 * 60 * 60 * 1000 })).toBe(SESSION_START_TIMEOUT_MS_MAX);
    });

    it('ignores an unusable hub value instead of spawning with it', () => {
        expect(resolveWebhookTimeoutMs({ requestedMs: 0 })).toBe(SESSION_START_TIMEOUT_MS_DEFAULT);
        expect(resolveWebhookTimeoutMs({ requestedMs: Number.NaN })).toBe(SESSION_START_TIMEOUT_MS_DEFAULT);
    });

    it('lets the runner env var win over the hub value, unclamped (#440 escape hatch)', () => {
        expect(resolveWebhookTimeoutMs({ env: '3600000', requestedMs: 60_000 })).toBe(3_600_000);
        expect(resolveWebhookTimeoutMs({ env: '1000' })).toBe(1_000);
    });

    it('falls through a junk env var to the configured value', () => {
        expect(resolveWebhookTimeoutMs({ env: 'soon', requestedMs: 45_000 })).toBe(45_000);
        expect(resolveWebhookTimeoutMs({ env: '0', requestedMs: 45_000 })).toBe(45_000);
        expect(resolveWebhookTimeoutMs({ env: '-5', requestedMs: 45_000 })).toBe(45_000);
    });
});

describe('formatTimeoutForMessage', () => {
    it('formats sub-minute and multi-minute waits', () => {
        expect(formatTimeoutForMessage(15_000)).toBe('15s');
        expect(formatTimeoutForMessage(60_000)).toBe('1m');
        expect(formatTimeoutForMessage(90_000)).toBe('1m 30s');
    });
});

describe('webhookTimeoutHint', () => {
    it('names the elapsed wait and both controls', () => {
        const hint = webhookTimeoutHint(15_000);
        expect(hint).toContain('within 15s');
        expect(hint).toContain('Settings');
        expect(hint).toContain('HAPI_RUNNER_WEBHOOK_TIMEOUT_MS');
    });
});
