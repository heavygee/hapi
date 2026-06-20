import type { Database } from 'bun:sqlite'

/**
 * Soup-only combined v10→v11 step: fcm_devices + session_scratchlist.
 *
 * Overseer events tables are NOT version-gated — Store.init calls
 * ensureOverseerEventsSchema() on every boot regardless of user_version.
 */
export function applySoupV10ToV11Migration(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS fcm_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            token TEXT NOT NULL,
            platform TEXT NOT NULL,
            device_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(namespace, device_id, platform)
        );
        CREATE INDEX IF NOT EXISTS idx_fcm_devices_namespace ON fcm_devices(namespace);
        CREATE INDEX IF NOT EXISTS idx_fcm_devices_token ON fcm_devices(token);

        CREATE TABLE IF NOT EXISTS session_scratchlist (
            session_id TEXT NOT NULL,
            entry_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, entry_id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_session_scratchlist_session_created
            ON session_scratchlist(session_id, created_at DESC);
    `)
}

export const SOUP_V11_TABLES = [
    'fcm_devices',
    'session_scratchlist',
    'events',
    'event_links',
    'events_fts',
    'deleted_sessions'
] as const
