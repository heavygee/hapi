import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Store } from './index'
import { removeMessageContentSearchForSessions } from './messageContentSearch'

function makeSession(store: Store, tag: string, namespace = 'default') {
    return store.sessions.getOrCreateSession(tag, { path: `/tmp/${tag}` }, null, namespace)
}

describe('message content search', () => {
    it('indexes visible user and assistant prose, including compressed messages', () => {
        const store = new Store(':memory:')
        const session = makeSession(store, 'content-search')
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'How do I rotate the cache key?' }
        })
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'Use the key rotation command.' } }
        })
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'tool-call', input: { text: 'cache key' } } }
        })
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'message', message: `long answer ${'cache rotation '.repeat(40)}` }
            }
        })
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    isMeta: true,
                    message: { content: [{ type: 'text', text: 'hidden cache rotation metadata' }] }
                }
            }
        })

        expect(store.messages.searchContent('rotate the cache', 'default').map((result) => result.sessionId))
            .toEqual([session.id])
        expect(store.messages.searchContent('rotation command', 'default')[0]?.role).toBe('assistant')
        expect(store.messages.searchContent('cache key', 'default')[0]?.role).toBe('user')
        expect(store.messages.searchContent('cache key', 'default')[0]?.snippet).toContain('cache')
        expect(store.messages.searchContent('hidden cache rotation', 'default')).toEqual([])
    })

    it('uses the indexed short-query path for CJK queries and isolates namespaces', () => {
        const store = new Store(':memory:')
        const defaultSession = makeSession(store, 'cjk-default')
        const otherSession = makeSession(store, 'cjk-other', 'other')
        store.messages.addMessage(defaultSession.id, {
            role: 'user',
            content: { type: 'text', text: '中文缓存搜索测试' }
        })
        store.messages.addMessage(otherSession.id, {
            role: 'user',
            content: { type: 'text', text: '中文缓存搜索测试' }
        })

        expect(store.messages.searchContent('搜索', 'default').map((result) => result.sessionId))
            .toEqual([defaultSession.id])
        expect(store.messages.searchContent('搜索', 'other').map((result) => result.sessionId))
            .toEqual([otherSession.id])
        expect(store.messages.searchContent('搜', 'default')).toEqual([])
        expect(store.messages.searchContentInSession('搜', 'default', defaultSession.id))
            .toEqual({ matches: [], total: 0 })
    })

    it('applies the result limit after deduplicating matching sessions', () => {
        const store = new Store(':memory:')
        const otherSession = makeSession(store, 'content-search-other')
        const busySession = makeSession(store, 'content-search-busy')

        store.messages.addMessage(otherSession.id, {
            role: 'user',
            content: { type: 'text', text: 'needle in another session' }
        })
        for (let index = 0; index < 201; index += 1) {
            store.messages.addMessage(busySession.id, {
                role: 'user',
                content: { type: 'text', text: `needle in frequent result ${index}` }
            })
        }
        store.sessions.touchSessionUpdatedAt(busySession.id, Date.now() + 1_000, 'default')

        expect(store.messages.searchContent('needle', 'default', 2).map((result) => result.sessionId))
            .toEqual([busySession.id, otherSession.id])
    })

    it('restricts global content search to requested sessions before applying the limit', () => {
        const store = new Store(':memory:')
        const first = makeSession(store, 'content-search-scope-first')
        const second = makeSession(store, 'content-search-scope-second')
        for (const session of [first, second]) {
            store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'scoped needle' }
            })
        }

        expect(store.messages.searchContent('scoped needle', 'default', 1, [second.id])
            .map((result) => result.sessionId))
            .toEqual([second.id])
    })

    it('returns message-level matches and the full count for one session', () => {
        const store = new Store(':memory:')
        const session = makeSession(store, 'message-level-search')
        const older = store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'needle in the older message' }
        })
        const newer = store.messages.addMessage(session.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'needle in the newer message' } }
        })
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'unrelated' } }
        })

        const result = store.messages.searchContentInSession('needle', 'default', session.id)
        expect(result.total).toBe(2)
        expect(result.matches.map((match) => match.messageId)).toEqual([newer.id, older.id])
        expect(result.matches.map((match) => match.sessionId)).toEqual([session.id, session.id])
    })

    it('does not expose queued messages until they are invoked', () => {
        const store = new Store(':memory:')
        const session = makeSession(store, 'queued-content')
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'queued secret phrase' }
        }, 'queued-1')

        expect(store.messages.searchContent('secret phrase', 'default')).toEqual([])
        store.messages.markMessagesInvoked(session.id, ['queued-1'], 123)
        expect(store.messages.searchContent('secret phrase', 'default')[0]?.sessionId).toBe(session.id)
    })

    it('keeps the derived index in sync with deletion and session merge', () => {
        const store = new Store(':memory:')
        const from = makeSession(store, 'merge-from')
        const to = makeSession(store, 'merge-to')
        const message = store.messages.addMessage(from.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'mergeable result' } }
        })

        expect(store.messages.searchContent('mergeable', 'default')[0]?.messageId).toBe(message.id)
        store.messages.mergeSessionMessages(from.id, to.id)
        expect(store.messages.searchContent('mergeable', 'default')[0]?.sessionId).toBe(to.id)
        store.sessions.deleteSession(to.id, 'default')
        expect(store.messages.searchContent('mergeable', 'default')).toEqual([])
    })

    it('cleans derived rows before a bulk session deletion', () => {
        const store = new Store(':memory:')
        const first = makeSession(store, 'bulk-delete-first')
        const second = makeSession(store, 'bulk-delete-second')
        for (const session of [first, second]) {
            store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'bulk cleanup phrase' }
            })
        }

        const db = (store as unknown as { db: Database }).db
        removeMessageContentSearchForSessions(db, [first.id, second.id])
        db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(first.id, second.id)

        expect(store.messages.searchContent('bulk cleanup phrase', 'default')).toEqual([])
    })
})
