/**
 * Per-session, workspace-local Cursor rule overlay for session status summaries.
 *
 * cursor-agent has no HAPI-controlled system-prompt channel (unlike claude/codex/
 * grok/opencode). It only discovers rules from workspace `.cursor/rules/*.mdc`
 * files (plain `.md` is ignored) and global `~/.cursor` user rules. Editing the
 * global user rules would pollute the operator's non-HAPI Cursor experience, so
 * we install a transient, repo-local rule for the lifetime of a session and
 * remove it on teardown.
 *
 * The rule asks the agent to end each response with a one-line machine-readable
 * status summary that this workspace's session tracking records. The line shape
 * mirrors `AGENT_NOTIFY_CONTRACT_INLINE_PREFIX` in `shared/src/overseerEvents.ts`.
 *
 * Concurrent sessions sharing a cwd use a shared restore sidecar + refcount so
 * the first overlay to arrive preserves the true pre-HAPI file, and only the
 * last cleanup restores it (earlier cleanups must not clobber an active peer
 * or permanently install another session's generated rule).
 *
 * All fs work is fail-open — a missing rule must never crash a session.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

const RULE_FILENAME = 'hapi-session.mdc';
/** Shared restore of the pre-HAPI file (user or tracked), keyed next to the rule. */
const RESTORE_SUFFIX = '.hapi-restore';
/** Active HAPI overlay count for this cwd; last decrement restores. */
const REFS_SUFFIX = '.hapi-refs';

/**
 * Hidden marker identifying files this overlay owns. Lets us distinguish a
 * user's pre-existing rule (back up + restore) from one written by another HAPI
 * session sharing the cwd.
 */
export const HAPI_SESSION_RULE_SENTINEL = '<!-- hapi:session-summary-rule -->';

export interface CursorNotifyRuleOverlay {
    /** Absolute path of the rule file this overlay manages. */
    readonly rulePath: string;
    /** Restore any pre-existing user file / remove ours, prune dirs we created. */
    cleanup: () => void;
}

export interface InstallCursorNotifyRuleOverlayOptions {
    /** Workspace root cursor-agent is spawned in (session.path). */
    cwd: string;
    /** Optional project name to bake into the example line. */
    project?: string | null;
    /** Optional agent id to bake into the example line. */
    agentId?: string | null;
}

/**
 * Build the `.mdc` rule content. `alwaysApply: true` so cursor-agent applies it
 * to every turn without the agent having to opt in. Kept deliberately benign and
 * functional: it reads as ordinary session-tracking config, not surveillance.
 *
 * Includes the operator-facing identity / @-mention section so managed Cursor
 * ACP sessions see the same phone/FCM rules as the tracked repo copy.
 */
export function buildNotifyRuleContent(opts: { project?: string | null; agentId?: string | null } = {}): string {
    const project = sanitizeToken(opts.project) ?? '<project>';
    const agentId = sanitizeToken(opts.agentId) ?? '<agent-id>';
    const exampleLine = `AGENT_NOTIFY_SUMMARY {"version":1,"agent":"${agentId}","project":"${project}","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"spoken answer or outcome"}`;
    const exampleNoAction = `AGENT_NOTIFY_SUMMARY {"version":1,"agent":"${agentId}","project":"${project}","status":"done","summary":"spoken answer or outcome"}`;

    return [
        '---',
        'alwaysApply: true',
        '---',
        HAPI_SESSION_RULE_SENTINEL,
        '',
        '# Session status summary',
        '',
        'End every response with a single machine-readable status line so this',
        "workspace's session tracking can record progress. Put it on its own final",
        'line, after all other content, with no code fences or backticks:',
        '',
        exampleLine,
        '',
        'When nothing remains, omit the action key entirely (example):',
        exampleNoAction,
        '',
        'Guidance:',
        '- status: pick the closest value; use "blocked" if unsure.',
        '- action: only when status is "done" and follow-up remains; 12 words or fewer.',
        '  Omit the action key when nothing remains. Never emit "action":"" —',
        '  Cursor drops a quote and breaks JSON.',
        '- summary: operator-facing one spoken sentence (phone/FCM). If the operator',
        '  asked a question this turn, answer that question here — do not describe',
        '  what you did. Use process/worklog language only when there was no question',
        '  (e.g. shipped a PR, waiting on CI).',
        '- Keep it as the very last line of every response.',
        '',
        '## Operator-facing session identity (mandatory)',
        '',
        'Phone, voice, and notify surfaces show `action` / `summary` with **no**',
        'sidebar. Bare session hashes (`6ce7f124`, `sid8`, UUID prefixes) are',
        '**forbidden** in `action`, `summary`, chat replies to the operator, and',
        'peer pings the operator will hear/read.',
        '',
        '### In HAPI chat / peer pings (chip affordance)',
        '',
        'Whenever you mention another agent/session to the operator (or in text the',
        'operator will open in HAPI), use the **session @-mention wire format** so the',
        'UI renders the same `@Name` chip as composer autocomplete / peer-delivery',
        'sender chips (click, hover tooltip, navigate):',
        '',
        '```markdown',
        '[upstream issue/pr discovery](/sessions/<full-session-id>)',
        '```',
        '',
        'That is how the rich composer serializes `@` picks (`composerSegments.ts`).',
        'Do **not** substitute bare names, bare `/sessions/<id>`, or `"Name" (id)`',
        'prose when a chip is possible.',
        '',
        'Bad: `6ce7f124` / `session 6ce7f124` / plain `upstream issue/pr discovery`',
        'Good: `[upstream issue/pr discovery](/sessions/6ce7f124-6240-4479-8dad-f2e27eb880a1)`',
        '',
        '### In `AGENT_NOTIFY_SUMMARY` action/summary (voice / FCM)',
        '',
        'Chips do not render on TTS. Use the **display name as spoken words** (still',
        'never a naked hash). Prefer the same title string the chip would show.',
        ''
    ].join('\n');
}

/**
 * Install the rule file at `<cwd>/.cursor/rules/hapi-session.mdc`, backing up any
 * pre-existing user file. Returns an overlay handle whose `cleanup()` restores
 * the prior state. Never throws: on failure it returns a no-op cleanup so callers
 * can wire it unconditionally.
 */
export function installCursorNotifyRuleOverlay(
    opts: InstallCursorNotifyRuleOverlayOptions
): CursorNotifyRuleOverlay {
    const cursorDir = join(opts.cwd, '.cursor');
    const rulesDir = join(cursorDir, 'rules');
    const rulePath = join(rulesDir, RULE_FILENAME);
    const restorePath = `${rulePath}${RESTORE_SUFFIX}`;
    const refsPath = `${rulePath}${REFS_SUFFIX}`;

    // Dirs we create so cleanup can prune exactly what we added (deepest first).
    const createdDirs: string[] = [];
    let cleaned = false;
    let installed = false;

    try {
        if (!existsSync(cursorDir)) {
            mkdirSync(cursorDir, { recursive: true });
            createdDirs.push(cursorDir);
        }
        if (!existsSync(rulesDir)) {
            mkdirSync(rulesDir, { recursive: true });
            createdDirs.push(rulesDir);
        }

        // First overlay in this cwd captures the true pre-HAPI bytes once.
        if (!existsSync(restorePath) && existsSync(rulePath)) {
            const existing = safeRead(rulePath);
            if (existing !== null) {
                writeFileSync(restorePath, existing, 'utf-8');
            }
        }

        const refs = readRefs(refsPath) + 1;
        writeFileSync(refsPath, String(refs), 'utf-8');
        writeFileSync(rulePath, buildNotifyRuleContent(opts), 'utf-8');
        installed = true;
        // File-only (debug) so journal/dogfood can prove the alwaysApply rule
        // landed before cursor-agent spawn without spamming the TUI.
        logger.debug(`[cursor-notify-rule] installed alwaysApply rule at ${rulePath} (refs=${refs})`);
    } catch (error) {
        logger.debug('[cursor-notify-rule] install failed', error);
    }

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (!installed) return;
        try {
            const remaining = Math.max(0, readRefs(refsPath) - 1);
            if (remaining > 0) {
                // Peer overlay still active — leave the live rule alone.
                writeFileSync(refsPath, String(remaining), 'utf-8');
                return;
            }

            // Last overlay out: restore pre-HAPI file or delete what we created.
            if (existsSync(restorePath)) {
                const restore = safeRead(restorePath);
                if (restore !== null) {
                    writeFileSync(rulePath, restore, 'utf-8');
                }
                rmSync(restorePath, { force: true });
            } else if (existsSync(rulePath)) {
                const current = safeRead(rulePath);
                if (current === null || current.includes(HAPI_SESSION_RULE_SENTINEL)) {
                    rmSync(rulePath, { force: true });
                }
            }
            rmSync(refsPath, { force: true });

            for (const dir of [...createdDirs].reverse()) {
                if (isEmptyDir(dir)) {
                    rmdirSync(dir);
                }
            }
        } catch (error) {
            logger.debug('[cursor-notify-rule] cleanup failed', error);
        }
    };

    return { rulePath, cleanup };
}

function readRefs(path: string): number {
    const raw = safeRead(path);
    if (raw === null) return 0;
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeRead(path: string): string | null {
    try {
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

function isEmptyDir(path: string): boolean {
    try {
        return readdirSync(path).length === 0;
    } catch {
        return false;
    }
}

/**
 * Keep only characters safe to bake into a JSON string example (no quotes/braces/
 * newlines). Returns null for empty/whitespace so callers fall back to the
 * placeholder token.
 */
function sanitizeToken(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[^A-Za-z0-9._\- /]/g, '').trim();
    return cleaned.length > 0 ? cleaned : null;
}
