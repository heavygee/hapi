import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { TodoBoardItemsResponse, TodoBoardsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { createTodoBoardRoutes, makeBoardId, parseProjectUrl } from './todoBoard'

const ENV_KEYS = [
    'HAPI_TODO_BOARD_HOST',
    'HAPI_TODO_BOARD_OWNER',
    'HAPI_TODO_BOARD_NUMBER',
    'HAPI_TODO_BOARD_STATUS_FIELD',
    'HAPI_TODO_BOARD_DONE_VALUES',
    'HAPI_TODO_BOARD_LABEL'
] as const

const directories: string[] = []

afterEach(async () => {
    for (const key of ENV_KEYS) {
        delete process.env[key]
    }
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createApp(
    runGraphql: Parameters<typeof createTodoBoardRoutes>[1],
    runGraphqlTitle?: Parameters<typeof createTodoBoardRoutes>[2]
) {
    const dataDir = await mkdtemp(join(tmpdir(), 'hapi-todo-board-'))
    directories.push(dataDir)
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    // Default the title lookup to a 404-shaped response (not the real `gh`
    // CLI) so items-focused tests that never add a board don't accidentally
    // make a network call just because they didn't pass a second mock.
    app.route('/api', createTodoBoardRoutes(dataDir, runGraphql, runGraphqlTitle ?? (() => ({ data: { repositoryOwner: {} } }))))
    return app
}

describe('makeBoardId', () => {
    it('does not collide when a component contains the join separator', () => {
        // host="github.com::evil" + owner="foo" vs. host="github.com" +
        // owner="evil::foo" would naively both join to the same string —
        // percent-encoding each component first prevents that.
        const idA = makeBoardId('github.com::evil', 'foo', 1)
        const idB = makeBoardId('github.com', 'evil::foo', 1)
        expect(idA).not.toBe(idB)
    })

    it('still produces the plain, readable id for normal inputs', () => {
        expect(makeBoardId('github.com', 'heavygee', 6)).toBe('github.com::heavygee::6')
    })
})

describe('parseProjectUrl', () => {
    it('parses a github.com user project URL', () => {
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6')).toEqual({
            host: 'github.com', ownerLogin: 'heavygee', projectNumber: 6
        })
    })

    it('parses an org project URL, a trailing slash, and a bare host (no scheme)', () => {
        expect(parseProjectUrl('https://github.com/orgs/acme/projects/42/')).toEqual({
            host: 'github.com', ownerLogin: 'acme', projectNumber: 42
        })
        expect(parseProjectUrl('github.com/users/heavygee/projects/6')).toEqual({
            host: 'github.com', ownerLogin: 'heavygee', projectNumber: 6
        })
    })

    it('parses a GHE host', () => {
        expect(parseProjectUrl('https://lhs.ghe.com/orgs/lockhouse/projects/3')).toEqual({
            host: 'lhs.ghe.com', ownerLogin: 'lockhouse', projectNumber: 3
        })
    })

    it('rejects anything that is not a recognizable Projects v2 URL', () => {
        expect(parseProjectUrl('https://github.com/heavygee/hapi')).toBeNull()
        expect(parseProjectUrl('not a url at all')).toBeNull()
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/not-a-number')).toBeNull()
    })
})

describe('GET /api/todo-boards', () => {
    it('defaults to the dull public demo board, never a real one, when unconfigured', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ boards: [{ id: 'github.com::heavygee::6', label: 'heavygee/6' }] })
    })

    it('reads the board from env when configured', async () => {
        process.env.HAPI_TODO_BOARD_OWNER = 'acme'
        process.env.HAPI_TODO_BOARD_NUMBER = '42'
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(await response.json()).toEqual({ boards: [{ id: 'github.com::acme::42', label: 'acme/42' }] })
    })

    it('ignores a non-numeric board number and falls back to the default', async () => {
        process.env.HAPI_TODO_BOARD_NUMBER = 'not-a-number'
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards')
        expect(await response.json()).toEqual({ boards: [{ id: 'github.com::heavygee::6', label: 'heavygee/6' }] })
    })
})

describe('POST /api/todo-boards', () => {
    it('rejects a missing or unparsable url', async () => {
        const app = await createApp(() => ({ data: {} }))
        const missing = await app.request('/api/todo-boards', { method: 'POST', body: JSON.stringify({}) })
        expect(missing.status).toBe(400)
        const bad = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'not a project url' })
        })
        expect(bad.status).toBe(400)
    })

    it('rejects a non-string url with 400, not a 500 from an uncaught TypeError', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 123 })
        })
        expect(response.status).toBe(400)
    })

    it('404s when the project does not resolve', async () => {
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: {} } }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/users/nobody/projects/1' })
        })
        expect(response.status).toBe(404)
    })

    it('adds a board, keeping the default in the list (add, not replace), using the project title as the label', async () => {
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap' } } } }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' })
        })
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards).toEqual([
            { id: 'github.com::heavygee::6', label: 'heavygee/6' },
            { id: 'github.com::acme::9', label: 'Acme Roadmap' }
        ])
    })

    it('validates via the lightweight title-only query, never the full items query', async () => {
        const itemsQuery = () => { throw new Error('should not call the heavy items query to add a board') }
        const app = await createApp(itemsQuery, () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap' } } } }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' })
        })
        expect(response.status).toBe(200)
    })

    it('is idempotent for the same board added twice', async () => {
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap' } } } }))
        await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' })
        })
        const second = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' })
        })
        const body = await second.json() as TodoBoardsResponse
        expect(body.boards).toHaveLength(2)
    })
})

describe('DELETE /api/todo-boards/:id', () => {
    it('removes a board from the list', async () => {
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap' } } } }))
        await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' })
        })
        const response = await app.request('/api/todo-boards/github.com%3A%3Aacme%3A%3A9', { method: 'DELETE' })
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards).toEqual([{ id: 'github.com::heavygee::6', label: 'heavygee/6' }])
    })

    it('safety invariant: removing the last board re-seeds the default instead of leaving an empty list', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6', { method: 'DELETE' })
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards).toEqual([{ id: 'github.com::heavygee::6', label: 'heavygee/6' }])
    })

    it('is a no-op for an id that does not exist', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/unknown', { method: 'DELETE' })
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards).toEqual([{ id: 'github.com::heavygee::6', label: 'heavygee/6' }])
    })
})

describe('GET /api/todo-boards/:id/items', () => {
    it('404s for an unknown board id', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/unknown/items')
        expect(response.status).toBe(404)
    })

    it('maps gh graphql items, status order, done values, and body', async () => {
        const app = await createApp(() => ({
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
                                        body: 'Some **markdown** body.',
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

        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.board).toEqual({ id: 'github.com::heavygee::6', label: 'heavygee/6' })
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
                updatedAt: '2026-10-06T12:00:00Z',
                body: 'Some **markdown** body.'
            },
            {
                id: 'item-2',
                title: 'Untracked idea',
                url: null,
                number: null,
                repo: null,
                state: null,
                status: null,
                updatedAt: null,
                body: null
            }
        ])
    })

    it('applies HAPI_TODO_BOARD_DONE_VALUES as a comma-separated override', async () => {
        process.env.HAPI_TODO_BOARD_DONE_VALUES = 'Done, Archived'
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.doneValues).toEqual(['Done', 'Archived'])
    })

    it('surfaces gh CLI failures as a 502 with the error message', async () => {
        const app = await createApp(() => {
            throw new Error('gh CLI not available: spawn gh ENOENT')
        })
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'gh CLI not available: spawn gh ENOENT' })
    })

    it('surfaces gh graphql errors array as a 502', async () => {
        const app = await createApp(() => ({ errors: [{ message: 'Could not resolve to a ProjectV2Owner' }] }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: 'Could not resolve to a ProjectV2Owner' })
    })
})
