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
 * Concurrent sessions sharing a cwd share ownership state under HAPI_HOME (not
 * inside the workspace) with live PIDs so: (1) only the last live owner restores
 * the pre-HAPI file, (2) crashed owners are reaped on the next install, and
 * (3) `git add -A` cannot stage bookkeeping sidecars.
 *
 * Non-clobbering discipline (mirrors how a config overlay behaves): if the user
 * already has a file at the same path we back up its contents and restore them on
 * cleanup; a file that already carries our sentinel is one of ours (a prior or
 * concurrent session in the same cwd), so we never treat it as user content —
 * UNLESS git tracks that path (headset canon on the hapi mirror) or the file
 * already contains the operator-facing identity section. All fs work is fail-open
 * — a missing rule must never crash a session.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    rmSync,
    rmdirSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { logger } from '@/ui/logger';
import { isProcessAlive } from '@/utils/process';

const RULE_FILENAME = 'hapi-session.mdc';
const RULE_RELPATH = join('.cursor', 'rules', RULE_FILENAME);
/** Extra canon beyond the stub: chip wire format + TTS (do not strip). */
const TRACKED_IDENTITY_MARKER = '## Operator-facing session identity';
const OWNERSHIP_LOCK_TIMEOUT_MS = 5_000;

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

type OverlayOwner = {
    /** Unique per install (same PID can own multiple overlays in tests / nested launches). */
    id: string;
    pid: number;
};

type OverlayOwnershipState = {
    cwd: string;
    owners: OverlayOwner[];
    /**
     * True once we have snapshotted the pre-HAPI rule state for this cwd.
     * Distinguishes "never captured" from "captured as absent" (`restore: null`).
     */
    snapshotTaken: boolean;
    /** Pre-HAPI rule bytes when `snapshotTaken`; null means no file existed. */
    restore: string | null;
};

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
    const absCwd = resolve(opts.cwd);
    const cursorDir = join(absCwd, '.cursor');
    const rulesDir = join(cursorDir, 'rules');
    const rulePath = join(rulesDir, RULE_FILENAME);
    const stateDir = getOverlayStateDir(absCwd);
    const statePath = join(stateDir, 'state.json');
    const lockPath = join(stateDir, 'state.lock');
    const ownerId = randomUUID();
    const pid = process.pid;

    // Dirs we create so cleanup can prune exactly what we added (deepest first).
    const createdDirs: string[] = [];
    let cleaned = false;
    /** Owner row written to HAPI_HOME state (even if the workspace rule write fails). */
    let registered = false;
    /** Workspace rule successfully overwritten with generated content. */
    let installed = false;
    /** Git-tracked (or identity-section) file: leave it alone on install and cleanup. */
    let preserveTracked = false;

    try {
        if (!existsSync(cursorDir)) {
            mkdirSync(cursorDir, { recursive: true });
            createdDirs.push(cursorDir);
        }
        if (!existsSync(rulesDir)) {
            mkdirSync(rulesDir, { recursive: true });
            createdDirs.push(rulesDir);
        }

        const existing = existsSync(rulePath) ? safeRead(rulePath) : null;
        preserveTracked = shouldPreserveTrackedSessionRule(absCwd, existing);

        if (preserveTracked) {
            logger.debug(`[cursor-notify-rule] skip clobber of tracked ${rulePath}`);
            return {
                rulePath,
                cleanup: () => {
                    if (cleaned) return;
                    cleaned = true;
                }
            };
        }

        if (!existsSync(stateDir)) {
            mkdirSync(stateDir, { recursive: true });
        }

        withOwnershipLock(lockPath, () => {
            let state = reapOwners(readOwnershipState(statePath, absCwd));
            if (state.owners.length === 0 && !state.snapshotTaken) {
                // First install (or recovered empty state): capture pre-HAPI bytes,
                // including an explicit "file was absent" snapshot.
                state = {
                    cwd: absCwd,
                    owners: [],
                    snapshotTaken: true,
                    restore: existsSync(rulePath) ? safeRead(rulePath) : null
                };
            } else if (state.owners.length === 0) {
                // Crash recovery: keep the prior snapshot (including restore:null).
                state = { ...state, owners: [] };
            }

            state.owners.push({ id: ownerId, pid });
            writeOwnershipState(statePath, state);
            registered = true;
        });

        writeFileSync(rulePath, buildNotifyRuleContent(opts), 'utf-8');
        installed = true;
        logger.debug(`[cursor-notify-rule] installed alwaysApply rule at ${rulePath}`);
    } catch (error) {
        logger.debug('[cursor-notify-rule] install failed', error);
    }

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (!registered) return;
        try {
            let clearStateDir = false;
            withOwnershipLock(lockPath, () => {
                let state = reapOwners(readOwnershipState(statePath, absCwd));
                state.owners = state.owners.filter((owner) => owner.id !== ownerId);
                if (state.owners.length > 0) {
                    writeOwnershipState(statePath, state);
                    return;
                }

                // Last live owner. Only mutate the workspace rule if we wrote it
                // and it is still HAPI-owned (sentinel present). Mid-session user
                // replacements without the sentinel are left alone.
                if (installed) {
                    const current = existsSync(rulePath) ? safeRead(rulePath) : null;
                    const stillOurs = current === null || current.includes(HAPI_SESSION_RULE_SENTINEL);
                    if (stillOurs) {
                        if (state.snapshotTaken && state.restore !== null) {
                            writeFileSync(rulePath, state.restore, 'utf-8');
                        } else if (state.snapshotTaken && state.restore === null) {
                            if (existsSync(rulePath)) {
                                rmSync(rulePath, { force: true });
                            }
                        }
                    }
                }

                clearStateDir = true;
            });
            if (clearStateDir) {
                rmSync(stateDir, { recursive: true, force: true });
            }

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

function shouldPreserveTrackedSessionRule(cwd: string, existing: string | null): boolean {
    const probe = spawnSync('git', ['-C', cwd, 'ls-files', '--error-unmatch', RULE_RELPATH], {
        encoding: 'utf-8',
        stdio: ['ignore', 'ignore', 'ignore']
    });
    if (probe.status === 0) {
        return true;
    }
    // Generated overlays also carry the identity section — sentinel distinguishes ours.
    if (
        existing !== null
        && existing.includes(TRACKED_IDENTITY_MARKER)
        && !existing.includes(HAPI_SESSION_RULE_SENTINEL)
    ) {
        return true;
    }
    return false;
}

function getHapiHomeDir(): string {
    const fromEnv = process.env.HAPI_HOME?.trim();
    if (fromEnv) {
        const expanded = fromEnv.replace(/^~(?=$|[/\\])/, homedir());
        return isAbsolute(expanded) ? expanded : resolve(expanded);
    }
    return join(homedir(), '.hapi');
}

function getOverlayStateDir(absCwd: string): string {
    const hash = createHash('sha256').update(absCwd).digest('hex').slice(0, 24);
    return join(getHapiHomeDir(), 'cursor-notify-overlays', hash);
}

function emptyOwnershipState(absCwd: string): OverlayOwnershipState {
    return { cwd: absCwd, owners: [], snapshotTaken: false, restore: null };
}

function readOwnershipState(path: string, absCwd: string): OverlayOwnershipState {
    const raw = safeRead(path);
    if (!raw) {
        return emptyOwnershipState(absCwd);
    }
    try {
        const parsed = JSON.parse(raw) as Partial<OverlayOwnershipState>;
        const owners: OverlayOwner[] = [];
        if (Array.isArray(parsed.owners)) {
            for (const entry of parsed.owners) {
                if (
                    entry
                    && typeof entry === 'object'
                    && typeof (entry as OverlayOwner).id === 'string'
                    && typeof (entry as OverlayOwner).pid === 'number'
                    && Number.isFinite((entry as OverlayOwner).pid)
                ) {
                    owners.push({ id: (entry as OverlayOwner).id, pid: (entry as OverlayOwner).pid });
                }
            }
        }
        const snapshotTaken = parsed.snapshotTaken === true
            || typeof parsed.restore === 'string'
            || owners.length > 0;
        return {
            cwd: absCwd,
            owners,
            snapshotTaken,
            restore: typeof parsed.restore === 'string' ? parsed.restore : null
        };
    } catch {
        return emptyOwnershipState(absCwd);
    }
}

function writeOwnershipState(path: string, state: OverlayOwnershipState): void {
    writeFileSync(path, JSON.stringify(state), 'utf-8');
}

function reapOwners(state: OverlayOwnershipState): OverlayOwnershipState {
    return {
        ...state,
        owners: state.owners.filter((owner) => isProcessAlive(owner.pid))
    };
}

function withOwnershipLock(lockPath: string, fn: () => void): void {
    const started = Date.now();
    while (true) {
        try {
            const fd = openSync(lockPath, 'wx');
            try {
                fn();
            } finally {
                closeSync(fd);
                try {
                    unlinkSync(lockPath);
                } catch {
                    // ignore
                }
            }
            return;
        } catch (error) {
            if (Date.now() - started >= OWNERSHIP_LOCK_TIMEOUT_MS) {
                throw error;
            }
            sleepSync(20);
        }
    }
}

function sleepSync(ms: number): void {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, ms);
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
