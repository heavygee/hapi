import { describe, expect, it } from 'bun:test'
import {
    filterOperatorSessions,
    isOperatorMicPathAllowed,
    isPathUnderProject,
    parseOperatorMicPath
} from './allowlist'

describe('hapi-inline composed allow-list (v0.10.0 contract)', () => {
    it('allows GET and POST /operator/sessions', () => {
        expect(parseOperatorMicPath('GET', '/operator/sessions')?.kind).toBe('operator-sessions')
        expect(parseOperatorMicPath('POST', '/operator/sessions')?.kind).toBe('operator-sessions')
        expect(isOperatorMicPathAllowed('GET', '/operator/sessions')).toBe(true)
    })

    it('allows session messages and upload only', () => {
        const id = '217719f7-479c-4250-99a6-ee15cbc1c6cc'
        expect(parseOperatorMicPath('GET', `/api/sessions/${id}/messages`)?.kind).toBe('session-action')
        expect(parseOperatorMicPath('POST', `/api/sessions/${id}/messages`)?.kind).toBe('session-action')
        expect(parseOperatorMicPath('POST', `/api/sessions/${id}/upload`)?.kind).toBe('session-action')
        expect(parseOperatorMicPath('GET', `/api/sessions/${id}/upload`)).toBeNull()
        expect(parseOperatorMicPath('POST', `/api/sessions/${id}/abort`)?.kind).toBe('session-action')
        expect(parseOperatorMicPath('GET', `/api/sessions/${id}/abort`)).toBeNull()
        expect(parseOperatorMicPath('POST', '/api/stt')).toBeNull()
        expect(parseOperatorMicPath('GET', '/api/stt')).toBeNull()
    })

    it('rejects raw GET /api/sessions and spawn', () => {
        expect(parseOperatorMicPath('GET', '/api/sessions')).toBeNull()
        expect(parseOperatorMicPath('GET', '/api/sessions?limit=50')).toBeNull()
        expect(parseOperatorMicPath('POST', '/api/machines/abc/spawn')).toBeNull()
        expect(isOperatorMicPathAllowed('GET', '/api/sessions')).toBe(false)
    })
})

describe('hapi-inline project path filter', () => {
    const project = '/home/heavygee/coding/hapi'

    it('keeps sessions under the HAPI checkout, including nested worktrees', () => {
        expect(isPathUnderProject(project, project)).toBe(true)
        expect(isPathUnderProject(`${project}/worktrees/foo`, project)).toBe(true)
        expect(isPathUnderProject('/home/heavygee/coding/jessica-story', project)).toBe(false)
        expect(isPathUnderProject('/home/heavygee/coding/hapi-extra', project)).toBe(false)
    })

    it('maps hub rows to picker fields only (name/active/updated/unread)', () => {
        const sessions = filterOperatorSessions([
            {
                id: 'in-tree',
                active: true,
                updatedAt: 9,
                pendingRequestsCount: 2,
                metadata: { name: 'Peer 120', path: project, flavor: 'cursor' }
            },
            {
                id: 'other-app',
                active: true,
                updatedAt: 8,
                pendingRequestsCount: 0,
                metadata: { name: 'Jessica', path: '/home/heavygee/coding/jessica-story' }
            }
        ], project)
        expect(sessions).toEqual([{
            id: 'in-tree',
            name: 'Peer 120',
            active: true,
            updatedAt: 9,
            flavor: 'cursor',
            unread: true
        }])
    })

    it('titles unnamed sessions like HAPI sidebar (summary → path segment → short id)', () => {
        const sessions = filterOperatorSessions([
            {
                id: 'b15b3422-4fdf-4019-9758-1463f57b3c0a',
                active: false,
                updatedAt: 1,
                metadata: { path: project, flavor: 'claude' }
            },
            {
                id: 'ccbe5489-5447-4f6a-b9ce-7b16c5f1cf50',
                active: false,
                updatedAt: 2,
                metadata: {
                    path: `${project}/worktrees/hub-runner-version-skew`,
                    flavor: 'claude',
                    summary: { text: '  ' }
                }
            },
            {
                id: 'sum-sess',
                active: false,
                updatedAt: 3,
                metadata: {
                    path: project,
                    summary: { text: 'A2A P3 Ingest' },
                    flavor: 'cursor'
                }
            }
        ], project)
        expect(sessions.map((s) => ({ id: s.id, name: s.name }))).toEqual([
            { id: 'b15b3422-4fdf-4019-9758-1463f57b3c0a', name: 'hapi' },
            { id: 'ccbe5489-5447-4f6a-b9ce-7b16c5f1cf50', name: 'hub-runner-version-skew' },
            { id: 'sum-sess', name: 'A2A P3 Ingest' }
        ])
        for (const s of sessions) {
            expect(s.name).not.toBe(s.id)
        }
    })
})
