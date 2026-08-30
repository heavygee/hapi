import type { Database } from 'bun:sqlite'
import {
    countSystemEvents,
    deleteSystemEventByIdempotencyKey,
    findSystemEventByIdempotencyKey,
    getSystemEventById,
    insertEventLink,
    insertSystemEvent,
    listSystemEvents,
    queryEvents,
    repointSessionEvents,
    type InsertSystemEventInput,
    type ListSystemEventsOptions,
    type QueryEventsOptions,
    type StoredSystemEvent
} from './events'

export type { InsertSystemEventInput, ListSystemEventsOptions, QueryEventsOptions, StoredSystemEvent }

export class EventStore {
    constructor(private readonly db: Database) {}

    insert(input: InsertSystemEventInput): StoredSystemEvent | null {
        return insertSystemEvent(this.db, input)
    }

    list(options: ListSystemEventsOptions = {}): StoredSystemEvent[] {
        return listSystemEvents(this.db, options)
    }

    query(options: QueryEventsOptions = {}): StoredSystemEvent[] {
        return queryEvents(this.db, options)
    }

    getById(id: number): StoredSystemEvent | null {
        return getSystemEventById(this.db, id)
    }

    count(): number {
        return countSystemEvents(this.db)
    }

    repointSession(fromSessionId: string, toSessionId: string): number {
        return repointSessionEvents(this.db, fromSessionId, toSessionId)
    }

    linkEvents(input: {
        fromEventId: number
        toEventId: number
        relationType: string
        createdAt: number
        metadataJson?: string | null
    }): string {
        return insertEventLink(this.db, input)
    }

    findByIdempotencyKey(idempotencyKey: string): StoredSystemEvent | null {
        return findSystemEventByIdempotencyKey(this.db, idempotencyKey)
    }

    deleteByIdempotencyKey(idempotencyKey: string): boolean {
        return deleteSystemEventByIdempotencyKey(this.db, idempotencyKey)
    }
}
