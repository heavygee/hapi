import { clampSessionStartTimeoutMs } from '@hapi/protocol/sessionStartTimeout';
import { sessionStartupTimeout } from './sessionStartup';

/**
 * How long this runner waits for a freshly spawned session to report back with
 * the session-start webhook before it tree-kills the child (tiann/hapi#2062).
 *
 * Priority, highest first:
 *
 * 1. `HAPI_RUNNER_WEBHOOK_TIMEOUT_MS` on the runner host — the headless /
 *    systemd escape hatch added in #440. Deliberately *not* clamped: operators
 *    running `opus[1m] --resume` legitimately wait far longer than any value a
 *    Settings slider should offer.
 * 2. The hub-configured value delivered with the spawn request (Settings).
 *    Clamped to the supported range so a bad hub value cannot park a hung
 *    child for a day.
 * 3. The per-agent default (15s; 30s for Codex, which has a slower startup).
 */
export function resolveWebhookTimeoutMs(options?: {
    env?: string | undefined
    requestedMs?: number | undefined
    agent?: string | undefined
}): number {
    const envValue = Number(options?.env);
    if (Number.isFinite(envValue) && envValue > 0) {
        return envValue;
    }
    return clampSessionStartTimeoutMs(options?.requestedMs) ?? sessionStartupTimeout(options?.agent);
}

/** `15s` / `1m 30s` — short enough to sit inside an error message. */
export function formatTimeoutForMessage(timeoutMs: number): string {
    const totalSeconds = Math.round(timeoutMs / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * Hint appended to the webhook-timeout error so the person staring at
 * "Session webhook timeout for PID 1234 (signal SIGTERM)" in the web UI can
 * see both knobs without reading the source (#2062).
 */
export function webhookTimeoutHint(timeoutMs: number): string {
    return `The session did not report back within ${formatTimeoutForMessage(timeoutMs)}.`
        + ' Slow hosts can raise "Session start timeout" in Settings → Machines,'
        + ' or set HAPI_RUNNER_WEBHOOK_TIMEOUT_MS on this runner.';
}
