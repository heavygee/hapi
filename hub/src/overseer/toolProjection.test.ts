import { describe, expect, it } from 'vitest'
import { projectToolResultForBrain } from './toolProjection'

describe('projectToolResultForBrain', () => {
    it('thins inbox items to id/what/status/priority and drops the fat', () => {
        const full = {
            total: 2,
            items: [
                {
                    id: 7, title: 'CI auth blocking 3 workers', status: 'surfaced', priority: 90,
                    category: 'blocker', summary: 'long summary…', reasonForPriority: 'shared root cause',
                    sourceEventIds: [1, 2, 3], artifactRefs: ['a'.repeat(400)], createdAt: 1, updatedAt: 2
                },
                { id: 8, title: 'needs a decision', status: 'new', priority: 40, artifactRefs: ['x'.repeat(400)] }
            ]
        }
        const lean = projectToolResultForBrain('query_inbox', full) as { total: number; items: unknown[] }
        expect(lean.total).toBe(2)
        expect(lean.items).toEqual([
            { id: 7, what: 'CI auth blocking 3 workers', status: 'surfaced', priority: 90 },
            { id: 8, what: 'needs a decision', status: 'new', priority: 40 }
        ])
        // the fat is gone
        expect(JSON.stringify(lean)).not.toContain('artifactRefs')
        expect(JSON.stringify(lean)).not.toContain('sourceEventIds')
        // and it is dramatically smaller
        expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length / 3)
    })

    it('preserves incoming (priority) order', () => {
        const full = { total: 3, items: [{ id: 1, priority: 99 }, { id: 2, priority: 50 }, { id: 3, priority: 10 }] }
        const lean = projectToolResultForBrain('query_inbox', full) as { items: Array<{ id: number }> }
        expect(lean.items.map((i) => i.id)).toEqual([1, 2, 3])
    })

    it('passes other tools through untouched', () => {
        const events = { events: [{ id: 1, summary: 'x' }] }
        expect(projectToolResultForBrain('query_events', events)).toBe(events)
    })
})
