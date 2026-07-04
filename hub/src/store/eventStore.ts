import type { Database } from 'bun:sqlite'
import {
    countSystemEvents,
    insertEventLink,
    insertSystemEvent,
    listSystemEvents,
    repointSessionEvents,
    type InsertSystemEventInput,
    type ListSystemEventsOptions,
    type StoredSystemEvent
} from './events'

export type { InsertSystemEventInput, ListSystemEventsOptions, StoredSystemEvent }

export class EventStore {
    constructor(private readonly db: Database) {}

    insert(input: InsertSystemEventInput): StoredSystemEvent | null {
        return insertSystemEvent(this.db, input)
    }

    list(options: ListSystemEventsOptions = {}): StoredSystemEvent[] {
        return listSystemEvents(this.db, options)
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
}
