import { describe, expect, it } from 'vitest'
import { getGroupDisplayName, resolveSessionProjectLabel } from './sessionProjectLabel'

describe('getGroupDisplayName', () => {
    it('keeps Other as-is and shortens absolute paths to last two segments', () => {
        expect(getGroupDisplayName('Other')).toBe('Other')
        expect(getGroupDisplayName('/home/heavygee/coding/hapi')).toBe('coding/hapi')
        expect(getGroupDisplayName('C:\\Users\\you\\coding\\server-setup')).toBe('coding/server-setup')
        expect(getGroupDisplayName('solo')).toBe('solo')
    })
})

describe('resolveSessionProjectLabel', () => {
    it('prefers worktree basePath over session path for project identity', () => {
        expect(resolveSessionProjectLabel({
            path: '/tmp/hapi-worktrees/feat-x',
            worktree: {
                basePath: '/home/heavygee/coding/hapi',
                branch: 'feat/x',
                name: 'feat-x',
                worktreePath: '/tmp/hapi-worktrees/feat-x',
            },
        })).toBe('coding/hapi')
    })

    it('falls back to metadata.path for simple sessions', () => {
        expect(resolveSessionProjectLabel({ path: '/home/heavygee/coding/server-setup' })).toBe('coding/server-setup')
    })

    it('returns null when neither basePath nor path is usable', () => {
        expect(resolveSessionProjectLabel({})).toBeNull()
        expect(resolveSessionProjectLabel({ path: '   ' })).toBeNull()
        expect(resolveSessionProjectLabel({ worktree: { basePath: '  ', branch: 'x', name: 'x' } })).toBeNull()
    })
})
