import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { TodoBoardItemsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { createTodoBoardRoutes } from './todoBoard'

function createApp(runGraphql: Parameters<typeof createTodoBoardRoutes>[0]) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createTodoBoardRoutes(runGraphql))
    return app
}

describe('GET /api/todo-boards', () => {
    it('returns the hardcoded board list', async () => {
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ boards: [{ id: 'heavygee-4', label: 'heavygee/4' }] })
    })
})

describe('GET /api/todo-boards/:id/items', () => {
    it('404s for an unknown board id', async () => {
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/unknown/items')
        expect(response.status).toBe(404)
    })

    it('maps gh graphql items, status order, and done values', async () => {
        const app = createApp(() => ({
            data: {
                repositoryOwner: {
                    projectV2: {
                        field: { options: [{ name: 'Todo' }, { name: 'In Progress' }, { name: 'Done' }] },
                        items: {
                            nodes: [
                                {
                                    id: 'item-1',
                                    content: {
                                        __typename: 'Issue',
                                        title: 'Fix the thing',
                                        number: 12,
                                        url: 'https://github.com/heavygee/little-list/issues/12',
                                        state: 'OPEN',
                                        repository: { nameWithOwner: 'heavygee/little-list' }
                                    },
                                    fieldValueByName: { name: 'In Progress' }
                                },
                                {
                                    id: 'item-2',
                                    content: { __typename: 'DraftIssue', title: 'Untracked idea' },
                                    fieldValueByName: null
                                }
                            ]
                        }
                    }
                }
            }
        }))

        const response = await app.request('/api/todo-boards/heavygee-4/items')
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.board).toEqual({ id: 'heavygee-4', label: 'heavygee/4' })
        expect(body.statusOrder).toEqual(['Todo', 'In Progress', 'Done'])
        expect(body.doneValues).toEqual(['Done'])
        expect(body.items).toEqual([
            {
                id: 'item-1',
                title: 'Fix the thing',
                url: 'https://github.com/heavygee/little-list/issues/12',
                number: 12,
                repo: 'heavygee/little-list',
                state: 'OPEN',
                status: 'In Progress'
            },
            {
                id: 'item-2',
                title: 'Untracked idea',
                url: null,
                number: null,
                repo: null,
                state: null,
                status: null
            }
        ])
    })

    it('surfaces gh CLI failures as a 502 with the error message', async () => {
        const app = createApp(() => {
            throw new Error('gh CLI not available: spawn gh ENOENT')
        })
        const response = await app.request('/api/todo-boards/heavygee-4/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'gh CLI not available: spawn gh ENOENT' })
    })

    it('surfaces gh graphql errors array as a 502', async () => {
        const app = createApp(() => ({ errors: [{ message: 'Could not resolve to a ProjectV2Owner' }] }))
        const response = await app.request('/api/todo-boards/heavygee-4/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'Could not resolve to a ProjectV2Owner' })
    })
})
