import type { Database } from 'bun:sqlite'

import { extractSearchableMessageText } from '@hapi/protocol/messages'
import { decodeMessageContent } from './contentCodec'

export const MESSAGE_CONTENT_SEARCH_TABLE = 'message_content_search'
const initializedDatabases = new WeakSet<object>()

export type MessageContentSearchMatch = {
    sessionId: string
    messageId: string
    role: 'user' | 'assistant'
    seq: number
    createdAt: number
    snippet: string
}

export type SessionMessageContentSearchResult = {
    matches: MessageContentSearchMatch[]
    total: number
}

type IndexableMessage = {
    id: string
    sessionId: string
    content: unknown
    seq: number
    createdAt: number
    invokedAt: number | null
}

type DbMessageRow = {
    row_id: number
    id: string
    session_id: string
    content: string | Uint8Array
    created_at: number
    seq: number
    invoked_at: number | null
}

const SEARCH_REBUILD_BATCH_SIZE = 500

type DbSearchRow = {
    message_id: string
    session_id: string
    role: 'user' | 'assistant'
    seq: number | string
    created_at: number | string
    snippet?: string | null
    searchable_text?: string
}

export function createMessageContentSearchTable(db: Database): void {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${MESSAGE_CONTENT_SEARCH_TABLE} USING fts5(
            searchable_text,
            message_id UNINDEXED,
            session_id UNINDEXED,
            seq UNINDEXED,
            created_at UNINDEXED,
            role UNINDEXED,
            tokenize = 'trigram'
        )
    `)
    initializedDatabases.add(db)
}

function ensureMessageContentSearchTable(db: Database): void {
    if (!initializedDatabases.has(db)) {
        createMessageContentSearchTable(db)
    }
}

export function removeMessageContentSearchIndex(db: Database, messageId: string): void {
    ensureMessageContentSearchTable(db)
    db.prepare(`DELETE FROM ${MESSAGE_CONTENT_SEARCH_TABLE} WHERE message_id = ?`).run(messageId)
}

function insertMessageContentSearchIndex(
    db: Database,
    message: { id: string; sessionId: string; text: string; role: 'user' | 'assistant'; seq: number; createdAt: number }
): void {
    db.prepare(`
        INSERT INTO ${MESSAGE_CONTENT_SEARCH_TABLE} (
            searchable_text, message_id, session_id, seq, created_at, role
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(message.text, message.id, message.sessionId, message.seq, message.createdAt, message.role)
}

export function indexMessageContent(db: Database, message: IndexableMessage): void {
    ensureMessageContentSearchTable(db)
    removeMessageContentSearchIndex(db, message.id)
    if (message.invokedAt === null) return

    const searchable = extractSearchableMessageText(message.content)
    if (!searchable) return

    insertMessageContentSearchIndex(db, {
        id: message.id,
        sessionId: message.sessionId,
        text: searchable.text,
        role: searchable.role,
        seq: message.seq,
        createdAt: message.createdAt
    })
}

export function rebuildMessageContentSearch(db: Database): void {
    db.transaction(() => {
        rebuildMessageContentSearchInternal(db)
    })()
}

function rebuildMessageContentSearchInternal(db: Database, sessionIds?: string[]): void {
    createMessageContentSearchTable(db)

    const insert = db.prepare(`
        INSERT INTO ${MESSAGE_CONTENT_SEARCH_TABLE} (
            searchable_text, message_id, session_id, seq, created_at, role
        ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    let selectBatch: ReturnType<Database['prepare']>
    if (sessionIds) {
        const placeholders = sessionIds.map(() => '?').join(', ')
        db.prepare(`DELETE FROM ${MESSAGE_CONTENT_SEARCH_TABLE} WHERE session_id IN (${placeholders})`).run(...sessionIds)
        selectBatch = db.prepare(`
            SELECT rowid AS row_id, id, session_id, content, created_at, seq, invoked_at
            FROM messages
            WHERE session_id IN (${placeholders})
              AND invoked_at IS NOT NULL
              AND rowid > ?
            ORDER BY rowid ASC
            LIMIT ?
        `)
    } else {
        db.exec(`DELETE FROM ${MESSAGE_CONTENT_SEARCH_TABLE}`)
        selectBatch = db.prepare(`
            SELECT rowid AS row_id, id, session_id, content, created_at, seq, invoked_at
            FROM messages
            WHERE invoked_at IS NOT NULL
              AND rowid > ?
            ORDER BY rowid ASC
            LIMIT ?
        `)
    }

    let afterRowId = 0
    while (true) {
        const rows = (sessionIds
            ? selectBatch.all(...sessionIds, afterRowId, SEARCH_REBUILD_BATCH_SIZE)
            : selectBatch.all(afterRowId, SEARCH_REBUILD_BATCH_SIZE)) as DbMessageRow[]
        if (rows.length === 0) break

        for (const row of rows) {
            const searchable = extractSearchableMessageText(decodeMessageContent(row.content))
            if (!searchable) continue
            insert.run(
                searchable.text,
                row.id,
                row.session_id,
                row.seq,
                row.created_at,
                searchable.role
            )
        }

        afterRowId = rows[rows.length - 1]!.row_id
    }
}

export function rebuildMessageContentSearchForSessions(
    db: Database,
    sessionIds: string[],
    alreadyInTransaction = false
): void {
    if (sessionIds.length === 0) return
    const rebuild = () => rebuildMessageContentSearchInternal(db, sessionIds)
    if (alreadyInTransaction) {
        rebuild()
    } else {
        db.transaction(rebuild)()
    }
}

export function removeMessageContentSearchForSession(db: Database, sessionId: string): void {
    ensureMessageContentSearchTable(db)
    db.prepare(`DELETE FROM ${MESSAGE_CONTENT_SEARCH_TABLE} WHERE session_id = ?`).run(sessionId)
}

function normalizeSearchQuery(query: string): string {
    return query.trim().replace(/\s+/g, ' ')
}

function escapeFtsPhrase(query: string): string {
    return `"${query.replaceAll('"', '""')}"`
}

function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function makeLikeSnippet(text: string, query: string): string {
    const lowerText = text.toLocaleLowerCase()
    const lowerQuery = query.toLocaleLowerCase()
    const matchAt = lowerText.indexOf(lowerQuery)
    const radius = 90
    const start = matchAt < 0 ? 0 : Math.max(0, matchAt - radius)
    const end = Math.min(text.length, (matchAt < 0 ? 0 : matchAt) + query.length + radius)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < text.length ? '…' : ''
    return `${prefix}${text.slice(start, end)}${suffix}`.replace(/\s+/g, ' ').trim()
}

export function searchMessageContent(
    db: Database,
    query: string,
    namespace: string,
    limit: number = 50
): MessageContentSearchMatch[] {
    ensureMessageContentSearchTable(db)
    const normalizedQuery = normalizeSearchQuery(query)
    if (!normalizedQuery) return []

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50
    const useLike = [...normalizedQuery].length < 3
    const rows = useLike
        ? db.prepare(`
            WITH ranked_matches AS (
                SELECT
                    f.message_id,
                    f.session_id,
                    f.role,
                    f.seq,
                    f.created_at,
                    f.searchable_text,
                    s.updated_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY f.session_id
                        ORDER BY CAST(f.seq AS INTEGER) DESC,
                                 CAST(f.created_at AS INTEGER) DESC,
                                 f.message_id DESC
                    ) AS session_rank
                FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
                INNER JOIN sessions AS s
                    ON s.id = f.session_id AND s.namespace = ?
                WHERE f.searchable_text LIKE ? ESCAPE '\\'
            )
            SELECT message_id, session_id, role, seq, created_at, searchable_text
            FROM ranked_matches
            WHERE session_rank = 1
            ORDER BY updated_at DESC, CAST(seq AS INTEGER) DESC
            LIMIT ?
        `).all(namespace, `%${escapeLikePattern(normalizedQuery)}%`, safeLimit) as DbSearchRow[]
        : db.prepare(`
            WITH ranked_matches AS (
                SELECT
                    f.message_id,
                    f.session_id,
                    f.role,
                    f.seq,
                    f.created_at,
                    s.updated_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY f.session_id
                        ORDER BY CAST(f.seq AS INTEGER) DESC,
                                 CAST(f.created_at AS INTEGER) DESC,
                                 f.message_id DESC
                    ) AS session_rank
                FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
                INNER JOIN sessions AS s
                    ON s.id = f.session_id AND s.namespace = ?
                WHERE ${MESSAGE_CONTENT_SEARCH_TABLE} MATCH ?
            )
            SELECT ranked.message_id, ranked.session_id, ranked.role, ranked.seq, ranked.created_at,
                   snippet(${MESSAGE_CONTENT_SEARCH_TABLE}, 0, '', '', '…', 24) AS snippet
            FROM ranked_matches AS ranked
            INNER JOIN ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
                ON f.message_id = ranked.message_id
            WHERE ranked.session_rank = 1
            ORDER BY ranked.updated_at DESC, CAST(ranked.seq AS INTEGER) DESC
            LIMIT ?
        `).all(namespace, escapeFtsPhrase(normalizedQuery), safeLimit) as DbSearchRow[]

    return rows.map((row) => ({
        sessionId: row.session_id,
        messageId: row.message_id,
        role: row.role,
        seq: Number(row.seq),
        createdAt: Number(row.created_at),
        snippet: useLike
            ? makeLikeSnippet(row.searchable_text ?? '', normalizedQuery)
            : String(row.snippet ?? '').replace(/\s+/g, ' ').trim()
    }))
}

/**
 * Return every matching message in one session for in-chat navigation.
 *
 * The sidebar deliberately deduplicates to one result per session. Once a
 * result is opened, the chat needs the message-level result set so the user
 * can move between older and newer matches without loading the whole session.
 */
export function searchMessageContentInSession(
    db: Database,
    query: string,
    namespace: string,
    sessionId: string,
    limit: number = 500
): SessionMessageContentSearchResult {
    ensureMessageContentSearchTable(db)
    const normalizedQuery = normalizeSearchQuery(query)
    if (!normalizedQuery) return { matches: [], total: 0 }

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 500
    const useLike = [...normalizedQuery].length < 3
    const countRow = useLike
        ? db.prepare(`
            SELECT COUNT(*) AS count
            FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
            INNER JOIN sessions AS s
                ON s.id = f.session_id AND s.namespace = ?
            WHERE f.session_id = ?
              AND f.searchable_text LIKE ? ESCAPE '\\'
        `).get(namespace, sessionId, `%${escapeLikePattern(normalizedQuery)}%`) as { count: number | string }
        : db.prepare(`
            SELECT COUNT(*) AS count
            FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
            INNER JOIN sessions AS s
                ON s.id = f.session_id AND s.namespace = ?
            WHERE f.session_id = ?
              AND ${MESSAGE_CONTENT_SEARCH_TABLE} MATCH ?
        `).get(namespace, sessionId, escapeFtsPhrase(normalizedQuery)) as { count: number | string }

    const rows = useLike
        ? db.prepare(`
            SELECT f.message_id, f.session_id, f.role, f.seq, f.created_at, f.searchable_text
            FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
            INNER JOIN sessions AS s
                ON s.id = f.session_id AND s.namespace = ?
            WHERE f.session_id = ?
              AND f.searchable_text LIKE ? ESCAPE '\\'
            ORDER BY CAST(f.seq AS INTEGER) DESC
            LIMIT ?
        `).all(namespace, sessionId, `%${escapeLikePattern(normalizedQuery)}%`, safeLimit) as DbSearchRow[]
        : db.prepare(`
            SELECT f.message_id, f.session_id, f.role, f.seq, f.created_at,
                   snippet(${MESSAGE_CONTENT_SEARCH_TABLE}, 0, '', '', '…', 24) AS snippet
            FROM ${MESSAGE_CONTENT_SEARCH_TABLE} AS f
            INNER JOIN sessions AS s
                ON s.id = f.session_id AND s.namespace = ?
            WHERE f.session_id = ?
              AND ${MESSAGE_CONTENT_SEARCH_TABLE} MATCH ?
            ORDER BY CAST(f.seq AS INTEGER) DESC
            LIMIT ?
        `).all(namespace, sessionId, escapeFtsPhrase(normalizedQuery), safeLimit) as DbSearchRow[]

    return {
        matches: rows.map((row) => ({
            sessionId: row.session_id,
            messageId: row.message_id,
            role: row.role,
            seq: Number(row.seq),
            createdAt: Number(row.created_at),
            snippet: useLike
                ? makeLikeSnippet(row.searchable_text ?? '', normalizedQuery)
                : String(row.snippet ?? '').replace(/\s+/g, ' ').trim()
        })),
        total: Number(countRow?.count ?? 0)
    }
}
