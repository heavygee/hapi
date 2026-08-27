import type { Database } from 'bun:sqlite'
import type { InboxOperatorAction } from '@hapi/protocol'
import type { StoredSystemEvent } from './events'
import {
    countInboxItems,
    findActiveInboxItemForSession,
    getInboxItemById,
    listInboxItems,
    promoteAttentionEvent,
    recordInboxOperatorAction,
    repointSessionInboxItems,
    sweepDecayedTerminalItems,
    type ListInboxItemsOptions,
    type StoredInboxItem
} from './inboxItems'

export type { ListInboxItemsOptions, StoredInboxItem }

export class InboxStore {
    constructor(private readonly db: Database) {}

    promoteAttentionEvent(event: StoredSystemEvent): StoredInboxItem | null {
        return promoteAttentionEvent(this.db, event)
    }

    list(options: ListInboxItemsOptions = {}): StoredInboxItem[] {
        return listInboxItems(this.db, options)
    }

    count(): number {
        return countInboxItems(this.db)
    }

    getById(id: number): StoredInboxItem | null {
        return getInboxItemById(this.db, id)
    }

    findActiveForSession(sessionId: string): StoredInboxItem | null {
        return findActiveInboxItemForSession(this.db, sessionId)
    }

    recordOperatorAction(
        inboxItemId: number,
        action: InboxOperatorAction,
        feedback: string | null = null,
        snoozedUntil: number | null = null
    ): StoredInboxItem | null {
        return recordInboxOperatorAction(this.db, inboxItemId, action, feedback, snoozedUntil)
    }

    repointSession(fromSessionId: string, toSessionId: string): number {
        return repointSessionInboxItems(this.db, fromSessionId, toSessionId)
    }

    /** Auto-resolve decayed terminal (completed) items. Returns rows resolved. */
    sweepDecayedTerminal(now: number = Date.now()): number {
        return sweepDecayedTerminalItems(this.db, now)
    }
}
