import { describe, expect, it } from 'vitest'
import type { BoardItem } from '@/types/api'
import { buildBoardItemSpawnMessage } from './boardItemSpawnMessage'

function makeItem(overrides: Partial<BoardItem>): BoardItem {
    return {
        id: 'id',
        title: 'Fix the thing',
        url: null,
        number: null,
        repo: null,
        state: null,
        status: null,
        updatedAt: null,
        body: null,
        isPullRequest: false,
        createdAt: null,
        closedAt: null,
        author: null,
        assignees: [],
        labels: [],
        milestone: null,
        customFields: [],
        ...overrides
    }
}

describe('buildBoardItemSpawnMessage', () => {
    it('includes the issue number in the heading when present', () => {
        expect(buildBoardItemSpawnMessage(makeItem({ title: 'Fix the thing', number: 12 })))
            .toBe('Fix the thing (#12)')
    })

    it('omits the number entirely for draft issues with no number', () => {
        expect(buildBoardItemSpawnMessage(makeItem({ title: 'Untracked idea' })))
            .toBe('Untracked idea')
    })

    it('appends the url on its own line when present', () => {
        expect(buildBoardItemSpawnMessage(makeItem({
            title: 'Fix the thing',
            number: 12,
            url: 'https://github.com/acme/widgets/issues/12'
        }))).toBe('Fix the thing (#12)\nhttps://github.com/acme/widgets/issues/12')
    })

    it('appends the body after a blank line when present', () => {
        expect(buildBoardItemSpawnMessage(makeItem({
            title: 'Fix the thing',
            number: 12,
            url: 'https://github.com/acme/widgets/issues/12',
            body: 'Some **markdown** body.'
        }))).toBe('Fix the thing (#12)\nhttps://github.com/acme/widgets/issues/12\n\nSome **markdown** body.')
    })

    it('skips a blank/whitespace-only body entirely', () => {
        expect(buildBoardItemSpawnMessage(makeItem({ title: 'Fix the thing', body: '   \n  ' })))
            .toBe('Fix the thing')
    })

    it('truncates a very long body to stay well under URL length limits', () => {
        const longBody = 'x'.repeat(2000)
        const result = buildBoardItemSpawnMessage(makeItem({ title: 'Fix the thing', body: longBody }))
        expect(result.length).toBeLessThan(1100)
        expect(result.endsWith('…')).toBe(true)
    })
})
