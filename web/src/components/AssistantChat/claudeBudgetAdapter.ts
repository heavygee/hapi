import type {
    AgentBudgetAxis,
    AgentBudgetEffectiveState,
    AgentBudgetMetadataRow,
    AgentBudgetState,
    ClaudeRateLimit,
    ClaudeUsage
} from '@hapi/protocol/types'

// Maps Claude SDK telemetry (rate_limit_event + assistant.usage + result.modelUsage)
// into the generic AgentBudgetState shape consumed by AgentBudgetIndicator.
//
// Differences vs Codex adapter (Phase A):
// - Claude does NOT have a credits axis. Rate-limit axes are session_5h and
//   weekly_max only; when they hit `rejected`, the user is blocked (no
//   credit-cover fallback as Codex has).
// - The SDK reports `rateLimitType` as an opaque string so adapter falls back
//   to label-fy unknown types (e.g. 'opus_5h' → 'Opus 5h').
// - Context window comes from SDK's reported `result.modelUsage[model].contextWindow`,
//   not a hard-coded model→window map.
// - `effective` = green / amber / red / blocked, computed from worst axis:
//     blocked  = any rate limit `status === 'rejected'`
//     red      = any axis pressure >= 90
//     amber    = any axis pressure >= 60
//     green    = otherwise

const AMBER_THRESHOLD = 60
const RED_THRESHOLD = 90

// Known rateLimitType values from claude-code SDK at time of writing.
// Unknown values are accepted and labelled best-effort - schema does not
// constrain them (record over opaque string).
const RATE_LIMIT_LABELS: Record<string, string> = {
    session_5h: '5h Session',
    five_hour: '5h Session',
    weekly_max: 'Weekly',
    weekly: 'Weekly',
    opus_5h: 'Opus 5h',
    opus_weekly: 'Opus Weekly'
}

function clampPercent(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    return Math.max(0, Math.min(100, value))
}

function formatPercent(value: number): string {
    return `${Math.round(clampPercent(value))}%`
}

function formatTokens(tokens: number | undefined): string {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) return '0'
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
    return Math.round(tokens).toString()
}

// Seconds < 1e10 (all unix dates for the next several decades).
// Milliseconds >= 1e12. Anything between is ambiguous but treated as seconds
// since ms would imply ~1971 which is never a valid reset date.
function normalizeTimestampMs(resetsAt: number): number {
    return resetsAt < 1e10 ? resetsAt * 1000 : resetsAt
}

function formatRelativeTime(ms: number): string {
    const diff = ms - Date.now()
    if (diff <= 0) return 'now'
    const totalSecs = Math.round(diff / 1000)
    const hours = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    if (hours >= 24) {
        const days = Math.floor(hours / 24)
        return `in ${days}d ${hours % 24}h`
    }
    if (hours > 0) return `in ${hours}h ${mins}m`
    return `in ${mins}m`
}

function formatAbsoluteTimestamp(ms: number): string {
    try {
        return new Date(ms).toLocaleString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })
    } catch {
        return ''
    }
}

function formatResetDetail(resetsAt: number | undefined): { detail: string; detailTitle: string } | undefined {
    if (typeof resetsAt !== 'number' || resetsAt <= 0) return undefined
    try {
        const ms = normalizeTimestampMs(resetsAt)
        const date = new Date(ms)
        if (Number.isNaN(date.getTime())) return undefined
        return {
            detail: `resets ${formatRelativeTime(ms)}`,
            detailTitle: formatAbsoluteTimestamp(ms)
        }
    } catch {
        return undefined
    }
}

function formatRateLimitTypeLabel(rateLimitType: string): string {
    const known = RATE_LIMIT_LABELS[rateLimitType]
    if (known) return known
    // Best-effort label for an unknown type: split on underscore, capitalise.
    return rateLimitType
        .split(/[_-]+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

function rateLimitPressure(limit: ClaudeRateLimit): number {
    const util = typeof limit.utilization === 'number' ? limit.utilization : 0
    const pct = clampPercent(util > 1 ? util : util * 100)
    if (limit.status === 'rejected') return 100
    return pct
}

function rateLimitDetail(limit: ClaudeRateLimit): { detail?: string; detailTitle?: string } {
    const reset = formatResetDetail(limit.resetsAt)
    if (limit.status === 'rejected') {
        return reset
            ? { detail: `Blocked · ${reset.detail}`, detailTitle: reset.detailTitle }
            : { detail: 'Blocked' }
    }
    if (limit.status === 'allowed_warning') {
        return reset ? reset : { detail: 'Approaching limit' }
    }
    return reset ? reset : {}
}

function deriveEffective(
    axes: AgentBudgetAxis[],
    rateLimits: Record<string, ClaudeRateLimit>
): { effective: AgentBudgetEffectiveState; reason: string } {
    const rejected = Object.values(rateLimits).find((l) => l.status === 'rejected')
    if (rejected) {
        const label = formatRateLimitTypeLabel(rejected.rateLimitType)
        const reset = formatResetDetail(rejected.resetsAt)
        return {
            effective: 'blocked',
            reason: reset
                ? `${label} limit reached · ${reset.detail}`
                : `${label} limit reached`
        }
    }
    if (axes.length === 0) {
        return { effective: 'green', reason: 'No usage telemetry yet' }
    }
    const dominant = axes.reduce((acc, axis) => (axis.pressure > acc.pressure ? axis : acc), axes[0])
    if (dominant.pressure >= RED_THRESHOLD) {
        return {
            effective: 'red',
            reason: `${dominant.label} at ${formatPercent(dominant.pressure)}`
        }
    }
    if (dominant.pressure >= AMBER_THRESHOLD) {
        return {
            effective: 'amber',
            reason: `${dominant.label} at ${formatPercent(dominant.pressure)}`
        }
    }
    return {
        effective: 'green',
        reason: `${dominant.label} at ${formatPercent(dominant.pressure)}`
    }
}

export function toClaudeBudgetState(usage: ClaudeUsage | undefined | null): AgentBudgetState | null {
    if (!usage) return null

    const axes: AgentBudgetAxis[] = []

    if (usage.contextWindow && usage.contextWindow.limitTokens > 0) {
        const cw = usage.contextWindow
        axes.push({
            id: 'context',
            label: 'Context',
            pressure: clampPercent(cw.percent),
            valueText: formatPercent(cw.percent),
            detail: `${formatTokens(cw.usedTokens)} / ${formatTokens(cw.limitTokens)} tokens`
        })
    }

    const rateLimits = usage.rateLimits ?? {}
    const rateEntries = Object.values(rateLimits)
    // Render rate-limit axes in a stable order: known types first, then unknowns alphabetised.
    const knownOrder = ['session_5h', 'five_hour', 'weekly_max', 'weekly', 'opus_5h', 'opus_weekly']
    const sortedRateLimits = [...rateEntries].sort((a, b) => {
        const ai = knownOrder.indexOf(a.rateLimitType)
        const bi = knownOrder.indexOf(b.rateLimitType)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.rateLimitType.localeCompare(b.rateLimitType)
    })

    for (const limit of sortedRateLimits) {
        const pressure = rateLimitPressure(limit)
        // Map opaque type to a stable axis id so dominant-axis comparison stays
        // consistent across rerenders (would otherwise flicker on type renames).
        const axisId = limit.rateLimitType.startsWith('session') || limit.rateLimitType === 'five_hour'
            ? 'fiveHour'
            : limit.rateLimitType.includes('weekly')
                ? 'weekly'
                : `rateLimit:${limit.rateLimitType}`
        const rlDetail = rateLimitDetail(limit)
        axes.push({
            id: axisId,
            label: formatRateLimitTypeLabel(limit.rateLimitType),
            pressure,
            valueText: limit.status === 'rejected' ? 'Blocked' : formatPercent(pressure),
            detail: rlDetail.detail,
            detailTitle: rlDetail.detailTitle,
            critical: limit.status === 'rejected'
        })
    }

    if (axes.length === 0) return null

    const metadata: AgentBudgetMetadataRow[] = []
    if (typeof usage.totalCostUSD === 'number' && usage.totalCostUSD > 0) {
        metadata.push({
            label: 'Cost (session)',
            value: `$${usage.totalCostUSD.toFixed(4).replace(/\.?0+$/, '')}`
        })
    }
    if (usage.resolvedModel) {
        metadata.push({ label: 'Model', value: usage.resolvedModel })
    }
    if (usage.modelUsage) {
        const tokens = Object.values(usage.modelUsage).reduce(
            (acc, entry) => {
                acc.input += entry.inputTokens ?? 0
                acc.output += entry.outputTokens ?? 0
                acc.cacheRead += entry.cacheReadInputTokens ?? 0
                acc.cacheCreation += entry.cacheCreationInputTokens ?? 0
                return acc
            },
            { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
        )
        if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation > 0) {
            metadata.push({
                label: 'Tokens (session)',
                value: `in ${formatTokens(tokens.input)} · out ${formatTokens(tokens.output)} · cache ${formatTokens(tokens.cacheRead + tokens.cacheCreation)}`
            })
        }
    }

    const { effective, reason } = deriveEffective(axes, rateLimits)

    // Operational axis = context if we have it, else the first rate-limit
    // axis we found. The renderer pins the centre number to this axis's
    // pressure so the gauge meaning is stable across all states.
    const contextAxis = axes.find((a) => a.id === 'context')
    const operationalAxisId = contextAxis ? 'context' : axes[0].id

    const dominantAxisId = axes.reduce(
        (acc, axis) => (axis.pressure > acc.pressure ? axis : acc),
        axes[0]
    ).id

    return {
        operationalAxisId,
        axes,
        effective,
        effectiveReason: reason,
        dominantAxisId,
        metadata: metadata.length > 0 ? metadata : undefined
    }
}
