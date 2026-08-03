import type { Database } from 'bun:sqlite'
import type { InboxOperatorAction } from '@hapi/protocol'
import type { StoredSystemEvent } from './events'
import {
    clusterDispositions,
    countInboxItems,
    findActiveInboxItemForSession,
    getInboxItemById,
    listDispositions,
    listInboxItems,
    promoteAttentionEvent,
    recordInboxOperatorAction,
    repointSessionInboxItems,
    type DispositionCluster,
    type DispositionGroupColumn,
    type ListInboxItemsOptions,
    type QueryDispositionsFilter,
    type StoredInboxItem,
    type StoredInboxOperatorAction
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

    /** R3 shared reader — list disposition rows (newest first) filtered by the predicate vocabulary. */
    listDispositions(filter: QueryDispositionsFilter = {}): StoredInboxOperatorAction[] {
        return listDispositions(this.db, filter)
    }

    /** R3 discovery mode — cluster dispositions by predicate columns (`GROUP BY` + `HAVING count>=N`). */
    clusterDispositions(
        groupBy: DispositionGroupColumn[],
        minCount: number,
        filter: QueryDispositionsFilter = {}
    ): DispositionCluster[] {
        return clusterDispositions(this.db, groupBy, minCount, filter)
    }
}
