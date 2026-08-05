import type { Session } from '../sync/syncEngine'
import type { SessionEndReason } from '@hapi/protocol'
import type { NotificationSendContext } from './notificationSendContext'

export type TaskNotification = {
    summary: string
    status?: string
}

/**
 * Model error notification: fires for non-transient model failures, or when a
 * transient bridge retry persistently fails (`retriedAndFailed`). Successful
 * auto/manual bridges stay in-session (banner + chat event) and must not ping
 * push/Telegram or create overseer/inbox attention.
 */
export type ModelErrorNotification = {
    kind: string                          // e.g. 'quota_exhausted', 'transport_closed'
    transient: boolean                    // retryable hint (rate_limit / canceled / timeout)
    rawSnippet: string                    // first 400 chars of the raw error text
    priorAssistantClaimsDone: boolean     // agent said "Done"/"Committed" right before the error
    atTs: number                          // metadata.lastModelError.atTs, used for dedup
}

/**
 * Outcome of a model-error channel send. Used by NotificationHub to decide
 * whether to keep or roll back the per-session watermark:
 * - delivered: at least one destination accepted the ping
 * - unavailable: channel had nothing to do (no subs, deferred to native, inactive)
 * - failed: channel tried and every destination failed
 */
export type ModelErrorSendOutcome = 'delivered' | 'unavailable' | 'failed'

export type NotificationChannel = {
    sendReady: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendPermissionRequest: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendTaskNotification: (session: Session, notification: TaskNotification, ctx?: NotificationSendContext) => Promise<void>
    sendSessionCompletion?: (session: Session, reason: SessionEndReason) => Promise<void>
    /**
     * Optional. Channels that don't implement it just skip model-error
     * pings (matches sendSessionCompletion's pattern). Wire this when
     * the channel can render a higher-urgency error variant.
     */
    sendModelError?: (session: Session, notification: ModelErrorNotification) => Promise<void>
}

export type NotificationHubOptions = {
    readyCooldownMs?: number
    permissionDebounceMs?: number
}
