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
 * Non-clobbering discipline (mirrors how a config overlay behaves): if anything
 * already exists at the same path (user rule, tracked repo copy, or a prior HAPI
 * overlay), we back up its contents and restore them on cleanup. Only a file we
 * created this session (no prior content) is removed on teardown. All fs work is
 * fail-open — a missing rule must never crash a session.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

const RULE_FILENAME = 'hapi-session.mdc';

/**
 * Hidden marker identifying files this overlay owns. Lets us distinguish a
 * user's pre-existing rule (back up + restore) from one written by another HAPI
 * session sharing the cwd (safe to overwrite / remove).
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

    // Dirs we create so cleanup can prune exactly what we added (deepest first).
    const createdDirs: string[] = [];
    // Verbatim contents of a user's pre-existing file, restored on cleanup.
    let preExistingContent: string | null = null;
    let cleaned = false;

    try {
        if (!existsSync(cursorDir)) {
            mkdirSync(cursorDir, { recursive: true });
            createdDirs.push(cursorDir);
        }
        if (!existsSync(rulesDir)) {
            mkdirSync(rulesDir, { recursive: true });
            createdDirs.push(rulesDir);
        }

        if (existsSync(rulePath)) {
            const existing = safeRead(rulePath);
            // Always preserve whatever was on disk (user rule, tracked repo copy,
            // or a prior HAPI overlay). Cleanup restores it instead of deleting,
            // so ending a session cannot dirty a checkout that ships the rule.
            if (existing !== null) {
                preExistingContent = existing;
            }
        }

        writeFileSync(rulePath, buildNotifyRuleContent(opts), 'utf-8');
        // File-only (debug) so journal/dogfood can prove the alwaysApply rule
        // landed before cursor-agent spawn without spamming the TUI.
        logger.debug(`[cursor-notify-rule] installed alwaysApply rule at ${rulePath}`);
    } catch (error) {
        logger.debug('[cursor-notify-rule] install failed', error);
    }

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        try {
            if (preExistingContent !== null) {
                // Restore the prior file exactly as it was.
                writeFileSync(rulePath, preExistingContent, 'utf-8');
                return;
            }

            // Only remove the file if we created it this session (nothing to
            // restore) and it is still ours (a user may have replaced it
            // mid-session; never delete their content).
            if (existsSync(rulePath)) {
                const current = safeRead(rulePath);
                if (current === null || current.includes(HAPI_SESSION_RULE_SENTINEL)) {
                    rmSync(rulePath, { force: true });
                }
            }

            // Prune dirs we created, deepest first, only while empty.
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
