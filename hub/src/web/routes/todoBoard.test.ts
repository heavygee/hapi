import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { TodoBoardItemsResponse, TodoBoardsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { createTodoBoardRoutes, makeBoardId, parseProjectUrl, parseValidatedItemUrl, resolveProjectView } from './todoBoard'

const ENV_KEYS = [
    'HAPI_TODO_BOARD_HOST',
    'HAPI_TODO_BOARD_OWNER',
    'HAPI_TODO_BOARD_NUMBER',
    'HAPI_TODO_BOARD_STATUS_FIELD',
    'HAPI_TODO_BOARD_DONE_VALUES',
    'HAPI_TODO_BOARD_LABEL',
    'HAPI_TODO_BOARD_ALLOWED_HOSTS'
] as const

// A dev machine actually configured to use this feature plausibly has one or
// more of these set in its shell already — snapshot and clear them once for
// the whole suite, then restore the caller's original values afterward,
// rather than unconditionally deleting them after every test (which would
// permanently wipe a value this process never set in the first place).
const originalEnv = new Map<string, string | undefined>()

beforeAll(() => {
    for (const key of ENV_KEYS) {
        originalEnv.set(key, process.env[key])
        delete process.env[key]
    }
})

afterAll(() => {
    for (const key of ENV_KEYS) {
        const value = originalEnv.get(key)
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }
})

const directories: string[] = []

afterEach(async () => {
    for (const key of ENV_KEYS) {
        delete process.env[key]
    }
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const UNUSED_ACTIONS: Parameters<typeof createTodoBoardRoutes>[4] = {
    close: async () => { throw new Error('close action not mocked for this test') },
    reopen: async () => { throw new Error('reopen action not mocked for this test') },
    comment: async () => { throw new Error('comment action not mocked for this test') },
    setStatus: async () => { throw new Error('setStatus action not mocked for this test') }
}

// Matches whichever board is asking — the safe default for tests that
// exercise close/reopen/comment/status success paths and don't care about
// membership verification specifically (that gets its own dedicated
// describe block). Echoes the target's own owner/number back so it always
// satisfies isMemberOfProject's comparison, regardless of which board/env
// config a given test uses.
const ALWAYS_MEMBER: Parameters<typeof createTodoBoardRoutes>[5] = (target) => ({
    data: { resource: { projectItems: { nodes: [{ project: { number: target.projectNumber, owner: { login: target.ownerLogin } } }] } } }
})

async function createApp(
    runGraphql: Parameters<typeof createTodoBoardRoutes>[1],
    runGraphqlTitle?: Parameters<typeof createTodoBoardRoutes>[2],
    namespace = 'default',
    runGraphqlView?: Parameters<typeof createTodoBoardRoutes>[3],
    actions?: Parameters<typeof createTodoBoardRoutes>[4],
    runGraphqlMembership?: Parameters<typeof createTodoBoardRoutes>[5]
) {
    const dataDir = await mkdtemp(join(tmpdir(), 'hapi-todo-board-'))
    directories.push(dataDir)
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    // Default the title/view lookups to 404-shaped responses (not the real
    // `gh` CLI) so items-focused tests that never add a board don't
    // accidentally make a network call just because they didn't pass a mock.
    app.route('/api', createTodoBoardRoutes(
        dataDir,
        runGraphql,
        runGraphqlTitle ?? (() => ({ data: { repositoryOwner: {} } })),
        runGraphqlView ?? (() => ({ data: { repositoryOwner: {} } })),
        actions ?? UNUSED_ACTIONS,
        runGraphqlMembership ?? ALWAYS_MEMBER
    ))
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

    it('appends a distinct view segment so the project and a view onto it can both be stored', () => {
        const plainId = makeBoardId('github.com', 'heavygee', 6)
        const viewId = makeBoardId('github.com', 'heavygee', 6, 8)
        expect(viewId).not.toBe(plainId)
        expect(viewId).toBe('github.com::heavygee::6::view::8')
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

    it('parses a trailing /views/<n> as a restrictive view onto the same project', () => {
        expect(parseProjectUrl('https://lhs.ghe.com/orgs/lockhouse/projects/3/views/8')).toEqual({
            host: 'lhs.ghe.com', ownerLogin: 'lockhouse', projectNumber: 3, viewNumber: 8
        })
    })

    it('parses a view URL with a trailing slash or query/hash', () => {
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6/views/1/')).toEqual({
            host: 'github.com', ownerLogin: 'heavygee', projectNumber: 6, viewNumber: 1
        })
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6/views/1?pane=info')).toEqual({
            host: 'github.com', ownerLogin: 'heavygee', projectNumber: 6, viewNumber: 1
        })
    })

    it('rejects an invalid view number the same way it rejects an invalid project number', () => {
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6/views/0')).toBeNull()
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6/views/not-a-number')).toBeNull()
    })

    it('does not mistake an unrelated trailing path that merely starts with "views" for a view segment', () => {
        // The "/views" rejection must be boundary-aware — otherwise a
        // trailing path like "/viewsomething" (which happens to start with
        // the same five letters) would be wrongly rejected as a malformed
        // view segment instead of accepted as ordinary trailing junk.
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/6/viewsomething')).toEqual({
            host: 'github.com', ownerLogin: 'heavygee', projectNumber: 6
        })
    })

    it('rejects anything that is not a recognizable Projects v2 URL', () => {
        expect(parseProjectUrl('https://github.com/heavygee/hapi')).toBeNull()
        expect(parseProjectUrl('not a url at all')).toBeNull()
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/not-a-number')).toBeNull()
    })

    it('rejects a project number that is not a valid GraphQL Int', () => {
        // $number: Int! is a non-fractional signed 32-bit value — anything
        // else always fails the subsequent gh api call, so reject it here.
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/1.5')).toBeNull()
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/0')).toBeNull()
        expect(parseProjectUrl('https://github.com/users/heavygee/projects/99999999999')).toBeNull()
    })
})

describe('owner-only namespace restriction', () => {
    it('rejects every board route for a non-default namespace', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'some-other-namespace')

        const list = await app.request('/api/todo-boards')
        expect(list.status).toBe(403)

        const add = await app.request('/api/todo-boards', { method: 'POST', body: JSON.stringify({ url: 'https://github.com/users/heavygee/projects/6' }) })
        expect(add.status).toBe(403)

        const del = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6', { method: 'DELETE' })
        expect(del.status).toBe(403)

        const items = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(items.status).toBe(403)
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

    it('ignores a fractional board number and falls back to the default', async () => {
        process.env.HAPI_TODO_BOARD_NUMBER = '1.5'
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

    it('rejects a board host outside the default allowlist (github.com only)', async () => {
        // A POST-supplied host reaches `gh api --hostname <host>`, which
        // resolves that host's credentials (including any enterprise
        // token) — without an allowlist, an attacker-controlled host in
        // the URL could make the hub leak its own token to it.
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: { projectV2: { title: 'x' } } } }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://attacker.example/orgs/acme/projects/9' })
        })
        expect(response.status).toBe(400)
    })

    it('allows an explicitly-configured host via HAPI_TODO_BOARD_ALLOWED_HOSTS', async () => {
        process.env.HAPI_TODO_BOARD_ALLOWED_HOSTS = 'github.com,lhs.ghe.com'
        const app = await createApp(() => ({ data: {} }), () => ({ data: { repositoryOwner: { projectV2: { title: 'Lockhouse TODO' } } } }))
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://lhs.ghe.com/orgs/lockhouse/projects/3' })
        })
        expect(response.status).toBe(200)
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

    it('adds a view-scoped board as a distinct board, labeled with the view name', async () => {
        const app = await createApp(
            () => ({ data: {} }),
            () => { throw new Error('should not use the plain title lookup for a view URL') },
            'default',
            () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { name: 'Sprint board' } } } } })
        )
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9/views/8' })
        })
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards).toEqual([
            { id: 'github.com::heavygee::6', label: 'heavygee/6' },
            { id: 'github.com::acme::9::view::8', label: 'Acme Roadmap · Sprint board' }
        ])
    })

    it('falls back to a generic "View N" label when the view has no name', async () => {
        const app = await createApp(
            () => ({ data: {} }),
            undefined,
            'default',
            () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: {} } } } })
        )
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9/views/8' })
        })
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards.find(b => b.id === 'github.com::acme::9::view::8')?.label).toBe('Acme Roadmap · View 8')
    })

    it('404s when the view number does not exist on the project', async () => {
        const app = await createApp(
            () => ({ data: {} }),
            undefined,
            'default',
            () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: null } } } })
        )
        const response = await app.request('/api/todo-boards', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9/views/999' })
        })
        expect(response.status).toBe(404)
    })

    it('allows adding both the plain project and a view onto it, as two separate boards', async () => {
        const app = await createApp(
            () => ({ data: {} }),
            () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap' } } } }),
            'default',
            () => ({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { name: 'Sprint board' } } } } })
        )
        await app.request('/api/todo-boards', { method: 'POST', body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9' }) })
        const response = await app.request('/api/todo-boards', { method: 'POST', body: JSON.stringify({ url: 'https://github.com/orgs/acme/projects/9/views/8' }) })
        const body = await response.json() as TodoBoardsResponse
        expect(body.boards.map(b => b.id)).toEqual(['github.com::heavygee::6', 'github.com::acme::9', 'github.com::acme::9::view::8'])
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

describe('parseValidatedItemUrl', () => {
    const board = { host: 'github.com' }

    it('accepts a well-formed issue URL on the board\'s own host', () => {
        expect(parseValidatedItemUrl('https://github.com/acme/widgets/issues/12', board)).toEqual({
            url: 'https://github.com/acme/widgets/issues/12',
            isPullRequest: false
        })
    })

    it('accepts a well-formed pull-request URL', () => {
        expect(parseValidatedItemUrl('https://github.com/acme/widgets/pull/9', board)).toEqual({
            url: 'https://github.com/acme/widgets/pull/9',
            isPullRequest: true
        })
    })

    it('rejects a URL on a different host — the SSRF-class case', () => {
        // The whole point of this check: a JWT caller supplying this URL
        // must not make the hub shell out `gh issue close` against an
        // arbitrary attacker-controlled host. GH_HOST does not protect
        // against this — gh dials the URL's own embedded host regardless —
        // so this check is the sole defense, not defense-in-depth.
        expect(parseValidatedItemUrl('https://attacker.example/acme/widgets/issues/12', board)).toBeNull()
    })

    it('rejects a non-https scheme even on the right host/path', () => {
        expect(parseValidatedItemUrl('http://github.com/acme/widgets/issues/12', board)).toBeNull()
        expect(parseValidatedItemUrl('file://github.com/acme/widgets/issues/12', board)).toBeNull()
    })

    it('matches host case-insensitively, normalizing the host in the rebuilt URL', () => {
        expect(parseValidatedItemUrl('https://GitHub.com/acme/widgets/issues/12', board)).toEqual({
            url: 'https://github.com/acme/widgets/issues/12',
            isPullRequest: false
        })
    })

    it('rebuilds a canonical URL rather than passing the raw input through', () => {
        // Trailing slash and query/fragment noise must not survive into the
        // string handed to `gh` — it's rebuilt from validated path parts.
        expect(parseValidatedItemUrl('https://github.com/acme/widgets/issues/12/?foo=bar#x', board)).toEqual({
            url: 'https://github.com/acme/widgets/issues/12',
            isPullRequest: false
        })
    })

    it('rejects a non-issue, non-pull path on the right host', () => {
        expect(parseValidatedItemUrl('https://github.com/acme/widgets', board)).toBeNull()
        expect(parseValidatedItemUrl('https://github.com/acme/widgets/discussions/1', board)).toBeNull()
    })

    it('rejects a malformed URL instead of throwing', () => {
        expect(parseValidatedItemUrl('not a url', board)).toBeNull()
    })

    it('preserves a non-default port — a GHE board on a custom port must not reject every write (Codex review)', () => {
        const portedBoard = { host: 'ghe.example:8443' }
        expect(parseValidatedItemUrl('https://ghe.example:8443/acme/widgets/issues/12', portedBoard)).toEqual({
            url: 'https://ghe.example:8443/acme/widgets/issues/12',
            isPullRequest: false
        })
        // Same hostname, different (or default/missing) port must still be rejected.
        expect(parseValidatedItemUrl('https://ghe.example/acme/widgets/issues/12', portedBoard)).toBeNull()
        expect(parseValidatedItemUrl('https://ghe.example:9999/acme/widgets/issues/12', portedBoard)).toBeNull()
    })
})

describe('resolveProjectView', () => {
    it('returns the title, view name, and trimmed filter on success', () => {
        const result = resolveProjectView({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { name: 'Sprint board', filter: ' status:"Done" ' } } } } }, 8)
        expect(result).toEqual({ ok: true, title: 'Acme Roadmap', viewName: 'Sprint board', itemsFilter: 'status:"Done"' })
    })

    it('treats an empty or whitespace-only filter the same as no filter', () => {
        expect(resolveProjectView({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { filter: '' } } } } }, 8)).toMatchObject({ ok: true, itemsFilter: undefined })
        expect(resolveProjectView({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { filter: '   ' } } } } }, 8)).toMatchObject({ ok: true, itemsFilter: undefined })
        expect(resolveProjectView({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: { filter: null } } } } }, 8)).toMatchObject({ ok: true, itemsFilter: undefined })
    })

    it('fails distinctly for a missing project vs. a missing view, both as "not found"', () => {
        const missingProject = resolveProjectView({ data: { repositoryOwner: {} } }, 8)
        expect(missingProject).toEqual({ ok: false, error: 'Project not found, or not accessible with the current gh auth' })

        const missingView = resolveProjectView({ data: { repositoryOwner: { projectV2: { title: 'Acme Roadmap', view: null } } } }, 8)
        expect(missingView).toEqual({ ok: false, error: 'View 8 not found on this project' })
    })

    it('surfaces top-level GraphQL errors without a "not found" message', () => {
        const result = resolveProjectView({ errors: [{ message: 'Could not resolve to a ProjectV2Owner' }] }, 8)
        expect(result).toEqual({ ok: false, error: 'Could not resolve to a ProjectV2Owner' })
    })
})

describe('GET /api/todo-boards/:id/items', () => {
    it('404s for an unknown board id', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/unknown/items')
        expect(response.status).toBe(404)
    })

    it('maps gh graphql items, status order, done values, body, and the richer item fields', async () => {
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
                                        createdAt: '2026-10-01T09:00:00Z',
                                        closedAt: null,
                                        body: 'Some **markdown** body.',
                                        repository: { nameWithOwner: 'acme/widgets' },
                                        author: { login: 'octocat', avatarUrl: 'https://example.com/octocat.png' },
                                        assignees: { nodes: [{ login: 'hubot', avatarUrl: 'https://example.com/hubot.png' }, null] },
                                        labels: { nodes: [{ name: 'bug', color: 'ff0000' }, null] },
                                        milestone: { title: 'v1.0', dueOn: '2026-12-01' }
                                    },
                                    fieldValueByName: { name: 'In Progress' },
                                    fieldValues: {
                                        nodes: [
                                            { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', field: { name: 'Status' } },
                                            { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'High', field: { name: 'Priority' } },
                                            { __typename: 'ProjectV2ItemFieldNumberValue', number: 3, field: { name: 'Points' } },
                                            { __typename: 'ProjectV2ItemFieldTextValue', text: '', field: { name: 'Empty text field' } },
                                            null
                                        ]
                                    }
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
                createdAt: '2026-10-01T09:00:00Z',
                closedAt: null,
                body: 'Some **markdown** body.',
                isPullRequest: false,
                author: { login: 'octocat', avatarUrl: 'https://example.com/octocat.png' },
                assignees: [{ login: 'hubot', avatarUrl: 'https://example.com/hubot.png' }],
                labels: [{ name: 'bug', color: 'ff0000' }],
                milestone: { title: 'v1.0', dueOn: '2026-12-01' },
                // Status is excluded (already surfaced via `status`); the
                // empty-string text value is excluded as not worth rendering.
                customFields: [
                    { name: 'Priority', value: 'High' },
                    { name: 'Points', value: '3' }
                ]
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
                createdAt: null,
                closedAt: null,
                body: null,
                isPullRequest: false,
                author: null,
                assignees: [],
                labels: [],
                milestone: null,
                customFields: []
            }
        ])
    })

    it('marks a PullRequest item as isPullRequest', async () => {
        const app = await createApp(() => ({
            data: {
                repositoryOwner: {
                    projectV2: {
                        field: { options: [] },
                        items: { nodes: [{ id: 'item-pr', content: { __typename: 'PullRequest', title: 'Bump deps', url: 'https://github.com/acme/widgets/pull/9' }, fieldValueByName: null }] }
                    }
                }
            }
        }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.items[0]?.isPullRequest).toBe(true)
    })

    it('applies HAPI_TODO_BOARD_DONE_VALUES as a comma-separated override', async () => {
        process.env.HAPI_TODO_BOARD_DONE_VALUES = 'Done, Archived'
        const app = await createApp(() => ({ data: { repositoryOwner: { projectV2: { field: { options: [] }, items: { nodes: [] } } } } }))
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

    it('404s when the configured project is missing or inaccessible (no top-level error)', async () => {
        // GitHub can return `projectV2: null` without a top-level GraphQL
        // error (owner exists, project number doesn't or isn't visible) —
        // without this check the route would 200 with an empty board.
        const app = await createApp(() => ({ data: { repositoryOwner: {} } }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(404)
    })

    it('502s when the configured status field name does not exist at all (field: null)', async () => {
        const app = await createApp(() => ({ data: { repositoryOwner: { projectV2: { field: null, items: { nodes: [] } } } } }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(502)
    })

    it('502s when the configured status field exists but is not a single-select (field: {})', async () => {
        // The inline fragment `... on ProjectV2SingleSelectField { options { name } }`
        // only contributes `options` when the concrete type matches — a
        // same-named field of a different type comes back as a truthy empty
        // object, not null.
        const app = await createApp(() => ({ data: { repositoryOwner: { projectV2: { field: {}, items: { nodes: [] } } } } }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(502)
    })

    it('skips a null entry in the items nodes array instead of throwing', async () => {
        const app = await createApp(() => ({
            data: {
                repositoryOwner: {
                    projectV2: {
                        field: { options: [{ name: 'Done' }] },
                        items: { nodes: [null, { id: 'item-1', content: { __typename: 'DraftIssue', title: 'Still here' } }] }
                    }
                }
            }
        }))
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(200)
        const body = await response.json() as TodoBoardItemsResponse
        expect(body.items).toHaveLength(1)
        expect(body.items[0]?.title).toBe('Still here')
    })

    it('maps a "not found" error from a view-scoped board\'s filter resolution to 404, not 502', async () => {
        // Simulates what the real runGhGraphql throws (via resolveProjectView)
        // when a stored view-scoped board's view or project has since been
        // deleted/renamed/access-revoked — should 404 the same way the
        // plain-project "projectV2: null" case does above, not fall through
        // to the generic 502 catch-all (which the existing "gh CLI not
        // available" test above already covers for non-"not found" errors).
        const app = await createApp(() => { throw new Error('View 8 not found on this project') })
        const response = await app.request('/api/todo-boards/github.com%3A%3Aheavygee%3A%3A6/items')
        expect(response.status).toBe(404)
    })
})

const DEFAULT_BOARD_ID = 'github.com::heavygee::6'
const VALID_ITEM_URL = 'https://github.com/heavygee/hapi-demo-board/issues/1'

// Shared by every write route via requireBoardAndValidUrl — exercised once
// here through `close` rather than duplicated across all four routes.
describe('write-target project membership verification', () => {
    it('rejects a same-host, well-formed URL that is not actually on this board\'s project', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, UNUSED_ACTIONS, () => ({
            data: { resource: { projectItems: { nodes: [] } } }
        }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(400)
    })

    it('rejects when the URL is on a different project under the same owner', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, UNUSED_ACTIONS, () => ({
            data: { resource: { projectItems: { nodes: [{ project: { number: 999, owner: { login: 'heavygee' } } }] } } }
        }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(400)
    })

    it('allows the write when the membership check confirms the item is on this project', async () => {
        const calls: unknown[] = []
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            close: async (target, comment) => { calls.push([target, comment]) }
        }, () => ({
            data: { resource: { projectItems: { nodes: [{ project: { number: 6, owner: { login: 'heavygee' } } }] } } }
        }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(200)
        expect(calls).toHaveLength(1)
    })

    it('matches the owner login case-insensitively', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            close: async () => {}
        }, () => ({
            data: { resource: { projectItems: { nodes: [{ project: { number: 6, owner: { login: 'HeavyGee' } } }] } } }
        }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(200)
    })

    it('surfaces a failed membership lookup as a 502, not a silent pass-through', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, UNUSED_ACTIONS, () => {
            throw new Error('gh api graphql failed: rate limited')
        })
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(502)
    })
})

describe('POST /api/todo-boards/:id/items/close', () => {
    it('closes via the close action and reports success', async () => {
        const calls: unknown[] = []
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            close: async (target, comment) => { calls.push([target, comment]) }
        })
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL, comment: 'done' })
        })
        expect(response.status).toBe(200)
        expect(calls).toEqual([[{ host: 'github.com', url: VALID_ITEM_URL, isPullRequest: false }, 'done']])
    })

    it('rejects an item URL that does not belong to the board', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: 'https://attacker.example/a/b/issues/1' })
        })
        expect(response.status).toBe(400)
    })

    it('404s for an unknown board', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request('/api/todo-boards/unknown/items/close', {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(404)
    })

    it('403s for a non-default namespace', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'some-other-namespace')
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(403)
    })

    it('surfaces a failed gh invocation as a 502, not a silently-swallowed success', async () => {
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            close: async () => { throw new Error('gh issue close failed: already closed') }
        })
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/close`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(502)
    })
})

describe('POST /api/todo-boards/:id/items/reopen', () => {
    it('reopens via the reopen action, deriving isPullRequest from the URL (not part of the request body)', async () => {
        const calls: unknown[] = []
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            reopen: async (target, comment) => { calls.push([target, comment]) }
        })
        // isPullRequest is deliberately not a client-supplied field at all —
        // the server derives it from the validated URL path, so a /pull/ URL
        // must come back as isPullRequest: true without the client ever
        // asserting that itself.
        const pullUrl = 'https://github.com/heavygee/hapi-demo-board/pull/1'
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/reopen`, {
            method: 'POST',
            body: JSON.stringify({ url: pullUrl })
        })
        expect(response.status).toBe(200)
        expect(calls).toEqual([[{ host: 'github.com', url: pullUrl, isPullRequest: true }, undefined]])
    })
})

describe('POST /api/todo-boards/:id/items/comment', () => {
    it('comments via the comment action', async () => {
        const calls: unknown[] = []
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            comment: async (target, body) => { calls.push([target, body]) }
        })
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/comment`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL, body: 'Looks good' })
        })
        expect(response.status).toBe(200)
        expect(calls).toEqual([[{ host: 'github.com', url: VALID_ITEM_URL, isPullRequest: false }, 'Looks good']])
    })

    it('rejects an empty comment body', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/comment`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL, body: '' })
        })
        expect(response.status).toBe(400)
    })
})

describe('POST /api/todo-boards/:id/items/status', () => {
    it('sets status via the setStatus action, resolving project number/owner/field from the board', async () => {
        const calls: unknown[] = []
        const app = await createApp(() => ({ data: {} }), undefined, 'default', undefined, {
            ...UNUSED_ACTIONS,
            setStatus: async (target) => { calls.push(target) }
        })
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/status`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL, status: 'Done' })
        })
        expect(response.status).toBe(200)
        expect(calls).toEqual([{
            host: 'github.com',
            ownerLogin: 'heavygee',
            projectNumber: 6,
            url: VALID_ITEM_URL,
            fieldName: 'Status',
            status: 'Done'
        }])
    })

    it('rejects a missing status value', async () => {
        const app = await createApp(() => ({ data: {} }))
        const response = await app.request(`/api/todo-boards/${DEFAULT_BOARD_ID}/items/status`, {
            method: 'POST',
            body: JSON.stringify({ url: VALID_ITEM_URL })
        })
        expect(response.status).toBe(400)
    })
})
