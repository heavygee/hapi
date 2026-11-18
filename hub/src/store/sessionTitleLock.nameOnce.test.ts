import { afterEach, describe, expect, it } from 'bun:test'
import {
    metadataHasDurableTitle,
    preserveSessionTitle,
    setNameOnceTitlePolicyEnabled
} from './sessionTitleLock'

afterEach(() => {
    setNameOnceTitlePolicyEnabled(false)
})

describe('name_once agent title policy', () => {
    it('treats name and summary as durable, not promptTitle', () => {
        expect(metadataHasDurableTitle({ promptTitle: 'First prompt' })).toBe(false)
        expect(metadataHasDurableTitle({ name: 'Spawned' })).toBe(true)
        expect(metadataHasDurableTitle({ summary: { text: 'Native' } })).toBe(true)
    })

    it('auto-locks the first agent title on an untitled session', () => {
        setNameOnceTitlePolicyEnabled(true)
        const next = preserveSessionTitle(
            { path: '/p', host: 'h' },
            { path: '/p', host: 'h', name: 'First title' }
        )
        expect(next).toMatchObject({ name: 'First title', titleLocked: true })
    })

    it('auto-locks create metadata that already has a spawn name', () => {
        setNameOnceTitlePolicyEnabled(true)
        const next = preserveSessionTitle(null, {
            path: '/p', host: 'h', name: 'Peer #271: name once'
        })
        expect(next).toMatchObject({
            name: 'Peer #271: name once',
            titleLocked: true
        })
    })

    it('blocks further agent renames once locked, but unlock allows one more then re-locks', () => {
        setNameOnceTitlePolicyEnabled(true)
        const locked = preserveSessionTitle(
            { path: '/p', host: 'h', name: 'Original', titleLocked: true },
            { path: '/p', host: 'h', name: 'Agent rewrite' }
        )
        expect(locked).toMatchObject({ name: 'Original', titleLocked: true })

        const unlocked = preserveSessionTitle(
            { path: '/p', host: 'h', name: 'Original', titleLocked: true },
            { path: '/p', host: 'h', name: 'Original' },
            { allowTitleUpdate: true, titleLocked: false }
        )
        expect(unlocked).toMatchObject({ name: 'Original' })
        expect(unlocked).not.toHaveProperty('titleLocked', true)

        const renamed = preserveSessionTitle(
            unlocked,
            { path: '/p', host: 'h', name: 'Better title' }
        )
        expect(renamed).toMatchObject({ name: 'Better title', titleLocked: true })
    })

    it('auto-locks user renames when lock is omitted under name_once', () => {
        setNameOnceTitlePolicyEnabled(true)
        const next = preserveSessionTitle(
            { path: '/p', host: 'h' },
            { path: '/p', host: 'h', name: 'Manual' },
            { allowTitleUpdate: true }
        )
        expect(next).toMatchObject({ name: 'Manual', titleLocked: true })
    })

    it('does not auto-lock when policy is allow_rename', () => {
        setNameOnceTitlePolicyEnabled(false)
        const next = preserveSessionTitle(
            { path: '/p', host: 'h' },
            { path: '/p', host: 'h', name: 'Agent' }
        )
        expect(next).toMatchObject({ name: 'Agent' })
        expect(next).not.toHaveProperty('titleLocked', true)
    })
})
