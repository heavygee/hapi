import { ApiError } from '@/api/client'

/**
 * Extracts the hub's crafted `{ error: string }` message from an ApiError's
 * body, falling back to the raw Error message (or a caller-supplied default)
 * when the body isn't that shape. Without this, ApiError.message surfaces the
 * raw "HTTP 400 Bad Request: {...}" string instead of the server's message.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError && err.body) {
        try {
            const parsed = JSON.parse(err.body) as { error?: unknown }
            if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
        } catch {
            // fall through
        }
    }
    return err instanceof Error ? err.message : fallback
}
