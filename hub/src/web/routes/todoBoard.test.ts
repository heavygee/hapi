import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { TodoBoardItemsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { createTodoBoardRoutes } from './todoBoard'

const ENV_KEYS = [
    'HAPI_TODO_BOARD_OWNER',
    'HAPI_TODO_BOARD_NUMBER',
    'HAPI_TODO_BOARD_STATUS_FIELD',
    'HAPI_TODO_BOARD_DONE_VALUES',
    'HAPI_TODO_BOARD_LABEL'
] as const

afterEach(() => {
    for (const key of ENV_KEYS) {
        delete process.env[key]
    }
})

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
    it('defaults to the dull public demo board, never a real one, when unconfigured', async () => {
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ boards: [{ id: 'heavygee-6', label: 'heavygee/6' }] })
    })

    it('reads the board from env when configured', async () => {
        process.env.HAPI_TODO_BOARD_OWNER = 'acme'
        process.env.HAPI_TODO_BOARD_NUMBER = '42'
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(await response.json()).toEqual({ boards: [{ id: 'acme-42', label: 'acme/42' }] })
    })

    it('ignores a non-numeric board number and falls back to the default', async () => {
        process.env.HAPI_TODO_BOARD_NUMBER = 'not-a-number'
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(await response.json()).toEqual({ boards: [{ id: 'heavygee-6', label: 'heavygee/6' }] })
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
                                        url: 'https://github.com/acme/widgets/issues/12',
                                        state: 'OPEN',
                                        updatedAt: '2026-10-06T12:00:00Z',
                                        repository: { nameWithOwner: 'acme/widgets' }
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

        const response = await app.request('/api/todo-boards/heavygee-6/items')
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.board).toEqual({ id: 'heavygee-6', label: 'heavygee/6' })
        expect(body.statusOrder).toEqual(['Todo', 'In Progress', 'Done'])
        expect(body.doneValues).toEqual(['Done'])
        expect(body.items).toEqual([
            {
                id: 'item-1',
                title: 'Fix the thing',
                url: 'https://github.com/acme/widgets/issues/12',
                number: 12,
                repo: 'acme/widgets',
                state: 'OPEN',
                status: 'In Progress',
                updatedAt: '2026-10-06T12:00:00Z'
            },
            {
                id: 'item-2',
                title: 'Untracked idea',
                url: null,
                number: null,
                repo: null,
                state: null,
                status: null,
                updatedAt: null
            }
        ])
    })

    it('applies HAPI_TODO_BOARD_DONE_VALUES as a comma-separated override', async () => {
        process.env.HAPI_TODO_BOARD_DONE_VALUES = 'Done, Archived'
        const app = createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/heavygee-6/items')
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.doneValues).toEqual(['Done', 'Archived'])
    })

    it('surfaces gh CLI failures as a 502 with the error message', async () => {
        const app = createApp(() => {
            throw new Error('gh CLI not available: spawn gh ENOENT')
        })
        const response = await app.request('/api/todo-boards/heavygee-6/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'gh CLI not available: spawn gh ENOENT' })
    })

    it('surfaces gh graphql errors array as a 502', async () => {
        const app = createApp(() => ({ errors: [{ message: 'Could not resolve to a ProjectV2Owner' }] }))
        const response = await app.request('/api/todo-boards/heavygee-6/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'Could not resolve to a ProjectV2Owner' })
    })
})
