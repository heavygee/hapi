/**
 * Harness-side Blocked stamp for unexpected Cursor stop exits.
 *
 * Operator-facing Blocked/notify UIs read `lastNotify` from a real
 * `AGENT_NOTIFY_SUMMARY` footer on assistant **text**. Error-shaped chat rows
 * alone never reach that path.
 */

/** Default action when the launcher has no sharper next step. */
export const UNEXPECTED_STOP_BLOCKED_ACTION = 'Continue or investigate';

/** Keeps the footer short and note-sized. */
const SUMMARY_MAX_CHARS = 160;

function clampNote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 'Unexpected stop; turn did not finish.';
    if (trimmed.length <= SUMMARY_MAX_CHARS) return trimmed;
    return `${trimmed.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}

export function formatUnexpectedStopBlockedFooter(input: {
    summary: string;
    action?: string;
}): string {
    const summary = clampNote(input.summary);
    const action = clampNote(input.action ?? UNEXPECTED_STOP_BLOCKED_ACTION);
    return `AGENT_NOTIFY_SUMMARY ${JSON.stringify({
        version: 1,
        status: 'blocked',
        action,
        summary
    })}`;
}
