import { describe, expect, it } from 'vitest';
import { isRetryableCursorError, stripRetryableCursorError } from './cursorAutoRetry';

describe('Cursor automatic retry classification', () => {
    it('recognizes Cursor connection failures without treating ordinary HTTP/2 prose as inline errors', () => {
        expect(isRetryableCursorError(new Error('http/2 stream closed with error code CANCEL'))).toBe(true);
        expect(isRetryableCursorError(new Error('HTTP/1.1 connection reset'))).toBe(true);
        expect(isRetryableCursorError(new Error('HTTP/2 401 Unauthorized'))).toBe(false);
        expect(stripRetryableCursorError('HTTP/2 is a binary framing protocol.')).toBeNull();
        expect(stripRetryableCursorError(
            'Partial answer\n\nError: RetriableError: [canceled] http/2 stream closed'
        )).toBe('Partial answer');
        expect(stripRetryableCursorError(
            'Example:\n```text\nError: RetriableError: [canceled] http/2 stream closed\n```'
        )).toBeNull();
    });

    it('retries the codes Cursor labels retriable, including resource_exhausted', () => {
        // The exact string seen in the wild (session ccd614cb, 2026-09-03).
        // It says "RetriableError" and used to fall through to a hard failure.
        expect(isRetryableCursorError(
            new Error('Error: RetriableError: [resource_exhausted] Error')
        )).toBe(true);
        expect(isRetryableCursorError(new Error('Error: RetriableError: [canceled] Error'))).toBe(true);
        expect(isRetryableCursorError(new Error('Error: RetriableError: [unavailable] Error'))).toBe(true);
        expect(isRetryableCursorError(new Error('Error: T: [deadline_exceeded] Error'))).toBe(true);
        // A code we have not catalogued: retry it. Cursor said retriable, and
        // CURSOR_AUTO_RETRY_LIMIT bounds the cost of being wrong.
        expect(isRetryableCursorError(new Error('Error: T: [some_new_code] Error'))).toBe(true);
    });

    it('refuses codes that no amount of retrying can fix', () => {
        for (const code of [
            'unauthenticated', 'permission_denied', 'invalid_argument',
            'not_found', 'unimplemented', 'failed_precondition'
        ]) {
            expect(isRetryableCursorError(new Error(`Error: RetriableError: [${code}] Error`)))
                .toBe(false);
        }
    });

    it('strips a resource_exhausted footer from partial output', () => {
        expect(stripRetryableCursorError(
            'Partial answer\n\nError: RetriableError: [resource_exhausted] Error'
        )).toBe('Partial answer');
    });

    it('does not let an earlier unrelated code veto later retryable evidence', () => {
        // Rejections carry up to 4000 chars of rolling stderr, so the first
        // coded line is often an unrelated probe from earlier in the session.
        expect(isRetryableCursorError(new Error(
            'Error: T: [not_found] probe failed\n...noise...\nError: RetriableError: [unavailable] Error'
        ))).toBe(true);
        expect(isRetryableCursorError(new Error(
            'Error: T: [not_found] probe failed\n...noise...\nhttp/2 stream closed'
        ))).toBe(true);
        // Exclusively permanent, no transport signal → still refused.
        expect(isRetryableCursorError(new Error(
            'Error: T: [not_found] a\nError: T: [permission_denied] b'
        ))).toBe(false);
    });

    it('refuses the real billing wall so its message is not buried', () => {
        // resource_exhausted is a Cursor internal transient; quota_exceeded is
        // the actual "go top up" signal and must surface, not burn 3 retries.
        expect(isRetryableCursorError(new Error('Error: T: [quota_exceeded] Error'))).toBe(false);
        expect(isRetryableCursorError(new Error('Error: T: [resource_exhausted] Error'))).toBe(true);
    });

    it('still covers transport prose, including transport closed', () => {
        expect(isRetryableCursorError(new Error('transport closed'))).toBe(true);
        expect(isRetryableCursorError(new Error('connection stalled'))).toBe(true);
        expect(isRetryableCursorError(new Error("ACP request 'session/prompt' timed out after 600000ms"))).toBe(true);
    });
});
