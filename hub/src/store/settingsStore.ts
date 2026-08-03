import type { Database } from 'bun:sqlite'

/**
 * Tiny key/value settings table for hub-side runtime config that must survive a restart and be
 * switchable at whim without editing env + bouncing the hub. First consumer: the Overseer's
 * active brain (which profile/model the converse + voice surfaces default to). Idempotent DDL,
 * run on every boot alongside the other Overseer self-heal schemas (not on the SCHEMA_VERSION ladder).
 */
export function ensureOverseerSettingsSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS overseer_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
    `)
}

/** The persisted active-brain selection — a profile id plus an optional model override. */
export type ActiveBrainSetting = {
    profile: string
    model: string | null
}

const ACTIVE_BRAIN_KEY = 'active_brain'

function activeBrainKey(namespace: string): string {
    const ns = namespace.trim() || 'default'
    return ns === 'default' ? ACTIVE_BRAIN_KEY : `${ACTIVE_BRAIN_KEY}:${ns}`
}

export class SettingsStore {
    constructor(private readonly db: Database) {}

    get(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM overseer_settings WHERE key = ?').get(key) as
            | { value: string }
            | undefined
        return row?.value ?? null
    }

    set(key: string, value: string): void {
        this.db
            .prepare(
                `INSERT INTO overseer_settings (key, value, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            )
            .run(key, value, Date.now())
    }

    delete(key: string): void {
        this.db.prepare('DELETE FROM overseer_settings WHERE key = ?').run(key)
    }

    /** Read the persisted active brain for a namespace, or null when unset. */
    getActiveBrain(namespace = 'default'): ActiveBrainSetting | null {
        const raw = this.get(activeBrainKey(namespace))
        if (!raw) return null
        try {
            const parsed = JSON.parse(raw) as Partial<ActiveBrainSetting>
            if (typeof parsed.profile !== 'string' || parsed.profile.length === 0) return null
            return { profile: parsed.profile, model: typeof parsed.model === 'string' ? parsed.model : null }
        } catch {
            return null
        }
    }

    setActiveBrain(value: ActiveBrainSetting, namespace = 'default'): void {
        this.set(activeBrainKey(namespace), JSON.stringify({ profile: value.profile, model: value.model ?? null }))
    }

    clearActiveBrain(namespace = 'default'): void {
        this.delete(activeBrainKey(namespace))
    }
}
