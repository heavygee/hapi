import { describe, expect, it } from 'vitest'
import { groupItemsByStatus } from './TodoBoardList'
import type { TodoBoardItem } from '@/types/api'

function makeItem(overrides: Partial<TodoBoardItem>): TodoBoardItem {
    return {
        id: overrides.id ?? 'id',
        title: overrides.title ?? 'title',
        url: overrides.url ?? null,
        number: overrides.number ?? null,
        repo: overrides.repo ?? null,
        state: overrides.state ?? null,
        status: overrides.status ?? null,
        updatedAt: overrides.updatedAt ?? null,
    }
}

describe('groupItemsByStatus', () => {
    it('orders open groups by the board status order, done pulled out regardless of column order', () => {
        const items = [
            makeItem({ id: 'a', status: 'Done' }),
            makeItem({ id: 'b', status: 'Todo' }),
            makeItem({ id: 'c', status: 'In Progress' }),
            makeItem({ id: 'd', status: 'Todo' }),
        ]
        const { openGroups, doneItems } = groupItemsByStatus(items, ['Todo', 'In Progress', 'Done'], ['Done'])

        expect(openGroups.map(g => g.status)).toEqual(['Todo', 'In Progress'])
        expect(openGroups[0].items.map(i => i.id)).toEqual(['b', 'd'])
        expect(openGroups[1].items.map(i => i.id)).toEqual(['c'])
        expect(doneItems.map(i => i.id)).toEqual(['a'])
    })

    it('buckets items with no status value into a trailing noStatus group', () => {
        const items = [
            makeItem({ id: 'a', status: 'Todo' }),
            makeItem({ id: 'b', status: null }),
        ]
        const { openGroups } = groupItemsByStatus(items, ['Todo'], ['Done'])

        expect(openGroups.map(g => g.status)).toEqual(['Todo', 'noStatus'])
        expect(openGroups[1].items.map(i => i.id)).toEqual(['b'])
    })

    it('appends statuses not present in statusOrder after the known ones', () => {
        const items = [
            makeItem({ id: 'a', status: 'Backlog' }),
            makeItem({ id: 'b', status: 'Todo' }),
        ]
        const { openGroups } = groupItemsByStatus(items, ['Todo'], ['Done'])

        expect(openGroups.map(g => g.status)).toEqual(['Todo', 'Backlog'])
    })

    it('treats multiple configured done values as done', () => {
        const items = [
            makeItem({ id: 'a', status: 'Done' }),
            makeItem({ id: 'b', status: 'Archived' }),
            makeItem({ id: 'c', status: 'Todo' }),
        ]
        const { openGroups, doneItems } = groupItemsByStatus(items, ['Todo', 'Done', 'Archived'], ['Done', 'Archived'])

        expect(openGroups.map(g => g.status)).toEqual(['Todo'])
        expect(doneItems.map(i => i.id).sort()).toEqual(['a', 'b'])
    })
})
