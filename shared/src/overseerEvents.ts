import type { NotifySummary } from './messages'

export const NOTIFY_SUMMARY_STATUSES = [
    'done',
    'blocked',
    'needs_review',
    'needs_decision',
    'failed',
    'stalled'
] as const

export type NotifySummaryStatus = typeof NOTIFY_SUMMARY_STATUSES[number]

/** Inline prefix injected for non-Cursor flavors on outbound user messages (#20). */
export const AGENT_NOTIFY_CONTRACT_INLINE_PREFIX = [
    'End every response with one machine-parseable line (no backticks):',
    'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}',
    'Use blocked if unsure. action must be concrete when status is done and follow-up is needed.',
    '',
    '---',
    ''
].join('\n')

export const HAPI_EVENTS_BEGIN = '<!--HAPI_EVENTS_BEGIN-->'
export const HAPI_EVENTS_END = '<!--HAPI_EVENTS_END-->'

export const OVERSEER_STALE_SILENCE_MS = 30 * 60 * 1000

export function mapNotifyStatusToEventType(status: string | undefined): string {
    switch (status) {
        case 'done':
            return 'completed'
        case 'blocked':
            return 'blocked'
        case 'needs_review':
            return 'needs_review'
        case 'needs_decision':
            return 'needs_decision'
        case 'failed':
            return 'failed'
        case 'stalled':
            return 'stale'
        default:
            return 'progress'
    }
}

export function deriveAttentionCandidate(status: string | undefined, action?: string): 0 | 1 {
    switch (status) {
        case 'needs_decision':
        case 'blocked':
        case 'failed':
        case 'needs_review':
        case 'stalled':
            return 1
        case 'done':
            return action && action.trim().length > 0 ? 1 : 0
        default:
            return 0
    }
}

export function deriveOperatorActionRequired(status: string | undefined, action?: string): 0 | 1 {
    return deriveAttentionCandidate(status, action)
}

export function deriveSeverity(eventType: string): number {
    switch (eventType) {
        case 'approval_requested':
        case 'permission_request':
        case 'needs_decision':
            return 5
        case 'blocked':
        case 'failed':
            return 4
        case 'needs_review':
        case 'stale':
            return 3
        case 'completed':
            return 2
        default:
            return 1
    }
}

export function buildEventSummaryFromNotify(notify: NotifySummary): string {
    const summary = notify.summary?.trim()
    if (summary) return summary
    const action = notify.action?.trim()
    if (action) return action
    const status = notify.status?.trim()
    if (status) return `Agent status: ${status}`
    return 'Agent turn summary'
}

export function detectEmptyHapiEventsSentinel(text: string): boolean {
    const pattern = new RegExp(
        `${escapeRegExp(HAPI_EVENTS_BEGIN)}\\s*${escapeRegExp(HAPI_EVENTS_END)}`,
        'm'
    )
    return pattern.test(text)
}

export function detectMalformedNotifySummaryLine(text: string): boolean {
    const lines = text.split('\n')
    let lastIdx = lines.length - 1
    while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx -= 1
    if (lastIdx < 0) return false
    const lastLine = lines[lastIdx].trim()
    if (!lastLine.startsWith('AGENT_NOTIFY_SUMMARY ')) return false
    const jsonPart = lastLine.slice('AGENT_NOTIFY_SUMMARY '.length).trim()
    if (!jsonPart.startsWith('{')) return true
    try {
        JSON.parse(jsonPart)
        return false
    } catch {
        return true
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
