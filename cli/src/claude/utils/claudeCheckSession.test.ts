import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeCheckSession, inspectClaudeTranscript } from './claudeCheckSession'
import { getProjectPath } from './path'

describe('claudeCheckSession / inspectClaudeTranscript', () => {
    let root: string
    let previousConfigDir: string | undefined

    beforeEach(() => {
        root = join(tmpdir(), `claude-check-${Date.now()}-${Math.random().toString(16).slice(2)}`)
        mkdirSync(root, { recursive: true })
        previousConfigDir = process.env.CLAUDE_CONFIG_DIR
        process.env.CLAUDE_CONFIG_DIR = join(root, '.claude')
    })

    afterEach(() => {
        if (previousConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR
        } else {
            process.env.CLAUDE_CONFIG_DIR = previousConfigDir
        }
        rmSync(root, { recursive: true, force: true })
    })

    it('returns onDisk:false when the transcript is missing', () => {
        expect(inspectClaudeTranscript({
            sessionId: 'missing-session',
            workspacePath: join(root, 'proj')
        })).toEqual({ onDisk: false })
        expect(claudeCheckSession('missing-session', join(root, 'proj'))).toBe(false)
    })

    it('returns onDisk:true when the project transcript exists with a uuid line', () => {
        const workspace = join(root, 'proj')
        mkdirSync(workspace, { recursive: true })
        const projectDir = getProjectPath(workspace)
        mkdirSync(projectDir, { recursive: true })
        const sessionId = '11111111-1111-4111-8111-111111111111'
        writeFileSync(
            join(projectDir, `${sessionId}.jsonl`),
            `${JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'hi' } })}\n`
        )
        expect(inspectClaudeTranscript({ sessionId, workspacePath: workspace })).toEqual({ onDisk: true })
        expect(claudeCheckSession(sessionId, workspace)).toBe(true)
    })

    it('finds a transcript under another project slug (cross-project lookup)', () => {
        const workspace = join(root, 'logical-path')
        mkdirSync(workspace, { recursive: true })
        const orphanSlug = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', '-orphan-other-path')
        mkdirSync(orphanSlug, { recursive: true })
        const sessionId = '22222222-2222-4222-8222-222222222222'
        writeFileSync(
            join(orphanSlug, `${sessionId}.jsonl`),
            `${JSON.stringify({ uuid: 'u2' })}\n`
        )
        expect(existsSync(join(getProjectPath(workspace), `${sessionId}.jsonl`))).toBe(false)
        expect(inspectClaudeTranscript({ sessionId, workspacePath: workspace })).toEqual({ onDisk: true })
        expect(claudeCheckSession(sessionId, workspace)).toBe(true)
    })
})
