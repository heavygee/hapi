export function formatSessionListDate(date: Date): string {
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}/${month}/${day}`
}

/**
 * Formats an epoch ms / s value as a localised relative age label.
 * Accepts both ms and seconds; values smaller than 1e12 are treated as seconds.
 *
 * Buckets:
 *   < 1 min   -> "just now"
 *   < 1 hour  -> "Nm ago"
 *   < 1 day   -> "Nh ago"
 *   < 14 days -> "Nd ago"
 *   < 60 days -> "Nw ago"
 *   < 330 days -> "Nmo ago"
 *   < 1 year  -> "almost 1y ago"
 *   else      -> absolute locale date (e.g. "6/13/2025")
 *
 * Returns `null` when the input is not finite.
 */
export type TFunc = (key: string, params?: Record<string, string | number>) => string

const DAY_MS = 24 * 60 * 60_000
const YEAR_MS = 365 * DAY_MS
/** Prefer "almost 1y ago" once roughly eleven months have passed. */
const ALMOST_YEAR_MS = 330 * DAY_MS

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
    if (days < 14) return t('session.time.daysAgo', { n: days })
    if (delta < 60 * DAY_MS) {
        const weeks = Math.max(2, Math.floor(days / 7))
        return t('session.time.weeksAgo', { n: weeks })
    }
    if (delta < ALMOST_YEAR_MS) {
        const months = Math.max(2, Math.floor(days / 30))
        return t('session.time.monthsAgo', { n: months })
    }
    if (delta < YEAR_MS) return t('session.time.almostOneYearAgo')
    return formatSessionListDate(new Date(ms))
}

/**
 * Absolute date+time string for tooltips alongside the relative label.
 */
export function formatAbsoluteDateTime(value: number): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    return new Date(ms).toLocaleString()
}
