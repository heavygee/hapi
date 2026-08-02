import { describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { SettingsStore, ensureOverseerSettingsSchema } from './settingsStore'

function freshStore(): SettingsStore {
    const db = new Database(':memory:', { strict: true })
    ensureOverseerSettingsSchema(db)
    return new SettingsStore(db)
}

describe('SettingsStore', () => {
    it('round-trips a raw key/value', () => {
        const s = freshStore()
        expect(s.get('missing')).toBeNull()
        s.set('k', 'v')
        expect(s.get('k')).toBe('v')
        s.set('k', 'v2')
        expect(s.get('k')).toBe('v2')
        s.delete('k')
        expect(s.get('k')).toBeNull()
    })

    it('round-trips the active brain (profile + model)', () => {
        const s = freshStore()
        expect(s.getActiveBrain()).toBeNull()
        s.setActiveBrain({ profile: 'openai', model: 'gpt-4o' })
        expect(s.getActiveBrain()).toEqual({ profile: 'openai', model: 'gpt-4o' })
    })

    it('normalizes a null model and clears', () => {
        const s = freshStore()
        s.setActiveBrain({ profile: 'local', model: null })
        expect(s.getActiveBrain()).toEqual({ profile: 'local', model: null })
        s.clearActiveBrain()
        expect(s.getActiveBrain()).toBeNull()
    })

    it('returns null on malformed persisted json rather than throwing', () => {
        const s = freshStore()
        s.set('active_brain', 'not json{')
        expect(s.getActiveBrain()).toBeNull()
        s.set('active_brain', JSON.stringify({ model: 'x' }))
        expect(s.getActiveBrain()).toBeNull()
    })

    it('round-trips conversational focus per namespace', () => {
        const s = freshStore()
        expect(s.getConverseFocus()).toBeNull()
        s.setConverseFocus({
            sessionId: '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff',
            itemId: 118,
            source: 'tool_resolve',
            updatedAt: 42
        })
        expect(s.getConverseFocus()).toEqual({
            sessionId: '6cd8d0c3-aaaa-bbbb-cccc-ddddeeeeffff',
            itemId: 118,
            source: 'tool_resolve',
            updatedAt: 42
        })
        s.setConverseFocus(
            {
                sessionId: 'other',
                itemId: null,
                source: 'operator',
                updatedAt: 99
            },
            'ns-a'
        )
        expect(s.getConverseFocus('ns-a')?.sessionId).toBe('other')
        expect(s.getConverseFocus()?.itemId).toBe(118)
        s.clearConverseFocus()
        expect(s.getConverseFocus()).toBeNull()
    })

    it('DDL is idempotent', () => {
        const db = new Database(':memory:', { strict: true })
        ensureOverseerSettingsSchema(db)
        ensureOverseerSettingsSchema(db)
        const store = new SettingsStore(db)
        store.set('a', 'b')
        expect(store.get('a')).toBe('b')
    })
})
