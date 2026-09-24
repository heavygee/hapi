/**
 * Canonical Cursor API key on disk (`~/.hapi/cursor.env`).
 *
 * Live ACP children inherit `process.env` at spawn (#1909 in-place relaunch).
 * When the fleet key on disk changes, refresh env then relaunch ACP under the
 * same hub + agent session id — same shape as model Auto relaunch.
 *
 * VERIFY BY KEY PREFIX, never `agent status` (docs/tooling/cursor-auth-fleet-sync.md).
 */

import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CANONICAL_CURSOR_ENV_PATH = join(homedir(), '.hapi', 'cursor.env');

/** First 12 chars of the key body after `crsr_` — safe for logs. */
export function cursorApiKeyLogPrefix(key: string): string {
    const trimmed = key.trim();
    if (!trimmed.startsWith('crsr_') || trimmed.length < 13) return 'invalid';
    return trimmed.slice(0, 12);
}

/**
 * Read the uncommented CURSOR_API_KEY from the canonical env file.
 * Returns null when missing or malformed (do not clear a live key).
 */
export function loadCanonicalCursorApiKey(
    envPath: string = CANONICAL_CURSOR_ENV_PATH
): string | null {
    let text: string;
    try {
        text = readFileSync(envPath, 'utf8');
    } catch {
        return null;
    }
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = /^CURSOR_API_KEY=(.*)$/.exec(trimmed);
        if (!match) continue;
        const value = match[1]!.trim().replace(/^['"]|['"]$/g, '');
        if (value.startsWith('crsr_') && value.length >= 20) return value;
    }
    return null;
}

export type ApplyCanonicalCursorApiKeyResult =
    | { applied: false; reason: 'missing_or_invalid' }
    | { applied: false; reason: 'unchanged'; keyPrefix: string }
    | { applied: true; keyPrefix: string; previousPrefix: string | null };

/**
 * Copy the canonical key into `process.env.CURSOR_API_KEY` when it differs.
 * Subsequent `createCursorAcpBackend` spawns inherit the refreshed value.
 */
export function applyCanonicalCursorApiKeyToProcessEnv(
    env: NodeJS.ProcessEnv = process.env,
    envPath: string = CANONICAL_CURSOR_ENV_PATH
): ApplyCanonicalCursorApiKeyResult {
    const canonical = loadCanonicalCursorApiKey(envPath);
    if (!canonical) return { applied: false, reason: 'missing_or_invalid' };
    const previous = env.CURSOR_API_KEY?.trim() || null;
    const keyPrefix = cursorApiKeyLogPrefix(canonical);
    if (previous === canonical) {
        return { applied: false, reason: 'unchanged', keyPrefix };
    }
    env.CURSOR_API_KEY = canonical;
    return {
        applied: true,
        keyPrefix,
        previousPrefix: previous ? cursorApiKeyLogPrefix(previous) : null
    };
}
