import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeCheckSession } from './claudeCheckSession'

describe('claudeCheckSession', () => {
    const dirs: string[] = []
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

    afterEach(() => {
        if (originalConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalConfigDir
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('resumes when the transcript lives under the realpath of session.path', () => {
        const root = mkdtempSync(join(tmpdir(), 'claude-check-session-'))
        dirs.push(root)
        const configDir = join(root, 'claude')
        process.env.CLAUDE_CONFIG_DIR = configDir

        const realCwd = join(root, 'work', 'coding', 'hapi')
        mkdirSync(realCwd, { recursive: true })
        const aliasParent = join(root, 'home', 'heavygee', 'coding')
        mkdirSync(aliasParent, { recursive: true })
        const aliasCwd = join(aliasParent, 'hapi')
        symlinkSync(realCwd, aliasCwd)

        const sessionId = '377f2300-dbd3-4ea9-8458-cffa6a222448'
        const projectDir = join(
            configDir,
            'projects',
            resolve(realCwd).replace(/[^a-zA-Z0-9]/g, '-'),
        )
        mkdirSync(projectDir, { recursive: true })
        writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${JSON.stringify({ uuid: sessionId })}\n`)

        expect(claudeCheckSession(sessionId, aliasCwd)).toBe(true)
    })
})
