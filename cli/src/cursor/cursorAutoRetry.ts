export const CURSOR_AUTO_RETRY_LIMIT = 3;

/**
 * Cursor tags its own transient failures `Error: T:` / `Error: RetriableError:`
 * followed by a gRPC-ish status code.
 *
 * We used to allow-list three codes (`canceled`, `deadline_exceeded`,
 * `unavailable`), which meant `[resource_exhausted]` — a Cursor-internal
 * transient, not a paid-quota wall — fell straight through to a hard failure
 * even though the error literally says it is retriable. Measured on a
 * 683-session fleet: 281 bridged model errors across 61 sessions, of which
 * `resource_exhausted`, `unknown_t_prefix` and `transport_closed` (89 events)
 * were never retried.
 *
 * So the rule is inverted: trust Cursor's retriable label and retry ANY code,
 * minus a small deny-list of codes that are definitionally permanent — no
 * amount of retrying fixes bad credentials or a missing model. The
 * `CURSOR_AUTO_RETRY_LIMIT` cap bounds the cost of being wrong about a code we
 * have not seen yet, which is strictly better than never retrying it.
 */
const NON_RETRYABLE_CURSOR_CODES: readonly string[] = [
    'unauthenticated',
    'permission_denied',
    'invalid_argument',
    'not_found',
    'unimplemented',
    'failed_precondition',
    // The REAL billing wall, as opposed to `resource_exhausted` (a Cursor
    // internal transient). Retrying this burns three attempts and then buries
    // the only message that tells the operator to go top up.
    'quota_exceeded',
    'resource_quota_exceeded'
];

/**
 * Every `Error: T: [code]` / `Error: RetriableError: [code]` in the text.
 *
 * Global on purpose. A rejection carries up to 4000 chars of rolling stderr
 * (`AcpStdioTransport.stderrForCloseError`), so the first coded line is often
 * an unrelated earlier probe. Letting it decide alone would make an earlier
 * `[not_found]` veto a genuine `[unavailable]` later in the same blob — a
 * narrowing versus the old match-anywhere behaviour.
 */
const CURSOR_CODED_ERROR_GLOBAL = /Error: (?:T|RetriableError): \[([a-z_]+)\]/gi;

/** Transport-level failures Cursor reports as prose rather than a coded error. */
const RETRYABLE_CURSOR_TRANSPORT = /(?:http\/(?:1\.1|2).*stream closed|connection (?:reset|stalled|closed)|transport (?:closed|reset)|ACP request 'session\/prompt' timed out after \d+ms)/i;

const INLINE_CURSOR_ERROR = /^[ \t]*Error: (?:T|RetriableError):/im;

export function isRetryableCursorError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    // Any retryable evidence anywhere wins; only an exclusively-permanent
    // blob with no transport signal is refused.
    for (const match of message.matchAll(CURSOR_CODED_ERROR_GLOBAL)) {
        const code = (match[1] ?? '').toLowerCase();
        if (!NON_RETRYABLE_CURSOR_CODES.includes(code)) return true;
    }

    return RETRYABLE_CURSOR_TRANSPORT.test(message);
}

export function stripRetryableCursorError(text: string): string | null {
    const marker = INLINE_CURSOR_ERROR.exec(text);
    if (!marker || !isRetryableCursorError(text.slice(marker.index))) return null;
    const before = text.slice(0, marker.index);
    if ((before.match(/^[ \t]{0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 === 1) return null;
    return text.slice(0, marker.index).trimEnd();
}
