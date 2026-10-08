export const CURSOR_AUTO_RETRY_LIMIT = 3;

// RetriableError:[resource_exhausted] is Cursor capacity/"high load" (forum +
// classifier transient:true) — retry like canceled/unavailable.
// Error: T:[resource_exhausted] stays OUT of this list: that form is treated as
// hard quota in the classifier (transient:false); retrying would hide the
// actionable quota message. Terminal path stamps Blocked instead.
const RETRYABLE_CURSOR_ERROR = /(?:Error: RetriableError: \[(?:canceled|deadline_exceeded|unavailable|resource_exhausted)\]|Error: T: \[(?:canceled|deadline_exceeded|unavailable)\]|http\/(?:1\.1|2).*stream closed|connection (?:reset|stalled|closed)|ACP request 'session\/prompt' timed out after \d+ms)/i;
const INLINE_CURSOR_ERROR = /^[ \t]*Error: (?:T|RetriableError):/im;

export function isRetryableCursorError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return RETRYABLE_CURSOR_ERROR.test(message);
}

export function stripRetryableCursorError(text: string): string | null {
    const marker = INLINE_CURSOR_ERROR.exec(text);
    if (!marker || !isRetryableCursorError(text.slice(marker.index))) return null;
    const before = text.slice(0, marker.index);
    if ((before.match(/^[ \t]{0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 === 1) return null;
    return text.slice(0, marker.index).trimEnd();
}
