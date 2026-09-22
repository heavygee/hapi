import { test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { insertSystemEvent, queryEventsWithPagination, ensureOverseerEventsSchema } from './events'

let db: Database

beforeEach(() => {
    db = new Database(':memory:')
    ensureOverseerEventsSchema(db)
})

test('queryEventsWithPagination - basic pagination with time bounds', () => {
    // Insert test events with different timestamps
    const baseTs = 1000000000000 // A base timestamp in milliseconds
    
    const event1 = insertSystemEvent(db, {
        ts: baseTs,
        sourceKind: 'worker',
        eventType: 'progress',
        attentionCandidate: 0,
        summary: 'Event 1',
        relatedSessionId: 'session1'
    })
    
    const event2 = insertSystemEvent(db, {
        ts: baseTs + 1000,
        sourceKind: 'worker', 
        eventType: 'blocked',
        attentionCandidate: 1,
        summary: 'Event 2',
        relatedSessionId: 'session1'
    })
    
    const event3 = insertSystemEvent(db, {
        ts: baseTs + 2000,
        sourceKind: 'worker',
        eventType: 'completed',
        attentionCandidate: 0,
        summary: 'Event 3',
        relatedSessionId: 'session1'
    })
    
    // Query with time bounds
    const result = queryEventsWithPagination(db, {
        sinceTs: baseTs,
        untilTs: baseTs + 1500,
        limit: 10
    })
    
    expect(result.events).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
    
    // Events should be in descending order by id
    expect(result.events[0].summary).toBe('Event 2')
    expect(result.events[1].summary).toBe('Event 1')
})

test('queryEventsWithPagination - cursor pagination with hasMore', () => {
    // Insert 5 test events
    const baseTs = 1000000000000
    for (let i = 0; i < 5; i++) {
        insertSystemEvent(db, {
            ts: baseTs + i * 1000,
            sourceKind: 'worker',
            eventType: 'progress',
            attentionCandidate: 0,
            summary: `Event ${i + 1}`,
            relatedSessionId: 'session1'
        })
    }
    
    // Query with limit 2 - should have more
    const result1 = queryEventsWithPagination(db, {
        limit: 2
    })
    
    expect(result1.events).toHaveLength(2)
    expect(result1.total).toBe(5)
    expect(result1.hasMore).toBe(true)
    expect(result1.nextCursor).toBeTruthy()
    
    // Query next page using cursor
    const result2 = queryEventsWithPagination(db, {
        beforeId: result1.nextCursor!,
        limit: 2
    })
    
    expect(result2.events).toHaveLength(2)
    expect(result2.total).toBe(3) // Total for remaining items before cursor
    expect(result2.hasMore).toBe(true)
    
    // Verify no overlap
    const result1Ids = result1.events.map(e => e.id)
    const result2Ids = result2.events.map(e => e.id)
    expect(result1Ids.some(id => result2Ids.includes(id))).toBe(false)
})

test('queryEventsWithPagination - forward pagination with afterId', () => {
    // Insert 3 events
    const baseTs = 1000000000000
    const events = []
    for (let i = 0; i < 3; i++) {
        const event = insertSystemEvent(db, {
            ts: baseTs + i * 1000,
            sourceKind: 'worker',
            eventType: 'progress',
            attentionCandidate: 0,
            summary: `Event ${i + 1}`,
            relatedSessionId: 'session1'
        })
        events.push(event)
    }
    
    // Query after first event (forward pagination)
    const result = queryEventsWithPagination(db, {
        afterId: events[0]!.id,
        limit: 10
    })
    
    expect(result.events).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.hasMore).toBe(false)
    
    // Should still be in descending order
    expect(result.events[0].summary).toBe('Event 3')
    expect(result.events[1].summary).toBe('Event 2')
})