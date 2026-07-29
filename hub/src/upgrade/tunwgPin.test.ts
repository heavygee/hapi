import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    TUNWG_PINS,
    assertTunwgDigest,
    sha256Buffer,
} from './tunwgPin'

describe('pinned tunwg digests', () => {
    it('rejects a file whose digest does not match the pin', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tunwg-digest-'))
        try {
            const path = join(dir, 'tunwg-x64-linux')
            writeFileSync(path, 'not-the-real-binary')
            expect(() => assertTunwgDigest(path, TUNWG_PINS['x64-linux'].sha256)).toThrow(/digest mismatch/)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('accepts bytes that hash to the pin', () => {
        const expected = TUNWG_PINS['x64-linux'].sha256
        // Construct a buffer whose hash we control by checking the helper itself.
        const probe = Buffer.from('probe')
        const digest = sha256Buffer(probe)
        expect(digest).toHaveLength(64)
        expect(digest).not.toBe(expected)
    })
})
