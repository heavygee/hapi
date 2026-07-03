/**
 * Smart relative-time formatting shared across surfaces (session list,
 * scratchlist entry indicators, future tooltip surfaces).
 *
 * "Smart" buckets:
 *   < 1 min  -> "just now"
 *   < 1 hour -> "Nm ago"
 *   < 1 day  -> "Nh ago"
 *   < 1 week -> "Nd ago"
 *   else     -> absolute locale date (e.g. "6/13/2026")
 *
 * Translation keys are reused from the session-list copy
 * (`session.time.justNow` etc.) to keep wording consistent and avoid a
 * per-feature translation set. Callers that want a different wording
 * should add their own keys; the shape of the formatter does not
 * assume any specific phrasing beyond the four buckets above.
 *
 * `value` is accepted in either seconds or milliseconds so callers
 * dealing with mixed timestamp formats (e.g. legacy session rows that
 * stored Unix seconds) don't have to normalise upstream. Anything
 * smaller than 10^12 is treated as seconds.
 */
export type TFunc = (key: string, params?: Record<string, string | number>) => string

export function formatRelativeTime(value: number, t: TFunc): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

/**
 * Absolute date+time string for tooltips that want the precise stamp
 * alongside the smart-relative label. Locale-aware.
 */
export function formatAbsoluteDateTime(value: number): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    return new Date(ms).toLocaleString()
}
