import { describe, expect, it, mock } from 'bun:test'
import {
    SearchContentError,
    searchSessionContent,
    formatSearchContentMatches,
    _test
} from './searchContent'

describe('parseContentSearchBody', () => {
    it('parses hub { results: [{ session, match }] } shape', () => {
        const result = _test.parseContentSearchBody({
            results: [{
                session: {
                    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    metadata: { name: 'Overseer stand-in', path: '/work/coding/hapi', flavor: 'cursor' }
                },
                match: {
                    messageId: 'msg-1',
                    role: 'assistant',
                    seq: 12,
                    createdAt: 1_700_000_000_000,
                    snippet: 'orphanReap ran clean'
                }
            }]
        })
        expect(result.total).toBe(1)
        expect(result.matches[0]?.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
        expect(result.matches[0]?.name).toBe('Overseer stand-in')
        expect(result.matches[0]?.snippet).toContain('orphanReap')
    })

    it('refuses bare success without results[] (no silent empty)', () => {
        expect(() => _test.parseContentSearchBody({ ok: true })).toThrow(SearchContentError)
        expect(() => _test.parseContentSearchBody([])).toThrow(SearchContentError)
        expect(() => _test.parseContentSearchBody(null)).toThrow(SearchContentError)
    })

    it('accepts explicit empty results as a real empty corpus', () => {
        const result = _test.parseContentSearchBody({ results: [] })
        expect(result.matches).toEqual([])
        expect(result.total).toBe(0)
    })
})

describe('formatSearchContentMatches', () => {
    it('labels real empty differently from failure copy', () => {
        const text = formatSearchContentMatches(
            { matches: [], total: 0 },
            { query: 'xyzzy' }
        )
        expect(text).toContain('real empty result')
        expect(text).toContain(_test.TRIGRAM_HINT)
    })
})

describe('searchSessionContent', () => {
    it('throws auth_failed on JWT exchange failure — never returns []', async () => {
        const http = {
            post: mock(async () => ({ status: 401, data: { error: 'unauthorized' } })),
            get: mock(async () => ({ status: 200, data: { results: [] } }))
        }

        await expect(searchSessionContent({
            query: 'orphanReap',
            apiUrl: 'http://hub.test',
            accessToken: 'fake-token',
            http: http as never
        })).rejects.toMatchObject({
            name: 'SearchContentError',
            code: 'auth_failed'
        })
        expect(http.get).not.toHaveBeenCalled()
    })

    it('throws auth_failed when content-search returns 401 after JWT', async () => {
        const http = {
            post: mock(async () => ({ status: 200, data: { token: 'jwt-ok' } })),
            get: mock(async () => ({ status: 401, data: { error: 'token expired' } }))
        }

        await expect(searchSessionContent({
            query: 'orphanReap',
            apiUrl: 'http://hub.test',
            accessToken: 'fake-token',
            http: http as never
        })).rejects.toMatchObject({
            code: 'auth_failed'
        })
    })

    it('throws unavailable when hub lacks the route (404)', async () => {
        const http = {
            post: mock(async () => ({ status: 200, data: { token: 'jwt-ok' } })),
            get: mock(async () => ({ status: 404, data: { error: 'Not Found' } }))
        }

        await expect(searchSessionContent({
            query: 'orphanReap',
            apiUrl: 'http://hub.test',
            accessToken: 'fake-token',
            http: http as never
        })).rejects.toMatchObject({
            code: 'unavailable'
        })
    })

    it('returns matches on success', async () => {
        const http = {
            post: mock(async () => ({ status: 200, data: { token: 'jwt-ok' } })),
            get: mock(async () => ({
                status: 200,
                data: {
                    results: [{
                        session: { id: '11111111-2222-3333-4444-555555555555', metadata: { name: 'Peer' } },
                        match: {
                            messageId: 'm1',
                            role: 'user',
                            seq: 1,
                            createdAt: 1,
                            snippet: 'hello orphanReap'
                        }
                    }]
                }
            }))
        }

        const result = await searchSessionContent({
            query: 'orphanReap',
            apiUrl: 'http://hub.test',
            accessToken: 'fake-token',
            http: http as never
        })
        expect(result.matches).toHaveLength(1)
        expect(result.matches[0]?.snippet).toContain('orphanReap')
    })

    it('rejects empty query', async () => {
        await expect(searchSessionContent({
            query: '  ',
            accessToken: 'x',
            apiUrl: 'http://hub.test'
        })).rejects.toMatchObject({ code: 'bad_args' })
    })
})
