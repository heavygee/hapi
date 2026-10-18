/**
 * Session-start timeout (tiann/hapi#2062).
 *
 * After the runner spawns an agent child it waits for that child to report
 * back with the "session started" webhook. If the webhook does not arrive the
 * runner tree-kills the child, because a child that never reports is
 * indistinguishable from a hung one (#440 / #1910).
 *
 * The default wait is 15s, which is short for constrained hosts (ChromeOS
 * Crostini, low-power laptops, cold npm/bun starts). The hub exposes this as a
 * Settings value so a non-operator user can raise it without editing systemd;
 * `HAPI_RUNNER_WEBHOOK_TIMEOUT_MS` on the runner host remains the override for
 * headless installs and is deliberately not clamped.
 */

/** Runner wait for the session-start webhook when nothing is configured. */
export const SESSION_START_TIMEOUT_MS_DEFAULT = 15_000

/**
 * Floor/ceiling for the *configured* value (Settings UI + hub API). Low
 * enough to stay useful on fast hosts, high enough for a cold agent boot on a
 * Chromebook — and far away from "set it to 24h and never notice a hung
 * child". The env override is not clamped.
 */
export const SESSION_START_TIMEOUT_MS_MIN = 5_000
export const SESSION_START_TIMEOUT_MS_MAX = 300_000

/**
 * Clamp a configured session-start timeout into the supported range.
 * Returns null for values that are not usable numbers at all, so callers can
 * fall back to the default instead of inventing one.
 */
export function clampSessionStartTimeoutMs(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null
    }
    const rounded = Math.round(parsed)
    if (rounded < SESSION_START_TIMEOUT_MS_MIN) return SESSION_START_TIMEOUT_MS_MIN
    if (rounded > SESSION_START_TIMEOUT_MS_MAX) return SESSION_START_TIMEOUT_MS_MAX
    return rounded
}
