import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    artifactFileName,
    bunCompileTarget,
    fingerprintArtifactInputs,
    isArtifactCacheFresh,
    normalizeCompiledArtifactPath,
    withStubEmbeddedAssets,
    type ArtifactMeta,
} from './cliArtifact'

describe('artifactFileName', () => {
    it('accepts normal version/platform/arch tokens', () => {
        expect(artifactFileName('0.23.0', 'linux', 'x64')).toBe('hapi-0.23.0-linux-x64')
        expect(artifactFileName('1.0.0-beta.1', 'darwin', 'arm64')).toBe('hapi-1.0.0-beta.1-darwin-arm64')
    })

    it('rejects path traversal and separators in any token', () => {
        expect(() => artifactFileName('../evil', 'linux', 'x64')).toThrow('Invalid artifact version')
        expect(() => artifactFileName('0.23.0', 'linux/../tmp', 'x64')).toThrow('Invalid artifact platform')
        expect(() => artifactFileName('0.23.0', 'linux', 'x64/../../tmp')).toThrow('Invalid artifact arch')
        expect(() => artifactFileName('0.23.0', 'linux', 'x64 with spaces')).toThrow('Invalid artifact arch')
    })
})

describe('bunCompileTarget', () => {
    it('maps fleet platforms including Windows (cross-compile from Linux hub)', () => {
        expect(bunCompileTarget('linux', 'x64')).toBe('bun-linux-x64-baseline')
        expect(bunCompileTarget('linux', 'arm64')).toBe('bun-linux-arm64')
        expect(bunCompileTarget('win32', 'x64')).toBe('bun-windows-x64')
        expect(bunCompileTarget('darwin', 'arm64')).toBe('bun-darwin-arm64')
    })

    it('rejects unsupported platform/arch instead of inventing a Bun target', () => {
        expect(() => bunCompileTarget('freebsd', 'x64')).toThrow('Unsupported compile target')
        expect(() => bunCompileTarget('win32', 'ia32')).toThrow('Unsupported compile target')
        expect(() => bunCompileTarget('win32', 'arm64')).toThrow('Unsupported compile target')
    })
})

describe('normalizeCompiledArtifactPath', () => {
    it('renames Bun-auto-suffixed .exe back to the extensionless artifact path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-artifact-exe-'))
        try {
            const outPath = join(dir, 'hapi-0.23.1-win32-x64')
            writeFileSync(`${outPath}.exe`, 'PE-bytes')
            expect(normalizeCompiledArtifactPath(outPath, 'win32')).toBe(outPath)
            expect(existsSync(outPath)).toBe(true)
            expect(existsSync(`${outPath}.exe`)).toBe(false)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('leaves non-Windows paths alone', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-artifact-nix-'))
        try {
            const outPath = join(dir, 'hapi-0.23.1-linux-x64')
            writeFileSync(outPath, 'ELF-bytes')
            expect(normalizeCompiledArtifactPath(outPath, 'linux')).toBe(outPath)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('withStubEmbeddedAssets', () => {
    it('restores the previous embeddedAssets.generated.ts after the callback', async () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-stub-assets-'))
        try {
            const webDir = join(root, 'hub', 'src', 'web')
            mkdirSync(webDir, { recursive: true })
            const manifest = join(webDir, 'embeddedAssets.generated.ts')
            const original = 'export const embeddedAssets = [{ path: "stale.js" }];\n'
            writeFileSync(manifest, original)

            let sawStub = false
            await withStubEmbeddedAssets(root, async () => {
                const during = readFileSync(manifest, 'utf8')
                expect(during).toContain('intentionally contains no embedded assets')
                expect(during).not.toContain('stale.js')
                sawStub = true
            })

            expect(sawStub).toBe(true)
            expect(readFileSync(manifest, 'utf8')).toBe(original)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('restores even when the callback throws', async () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-stub-assets-err-'))
        try {
            const webDir = join(root, 'hub', 'src', 'web')
            mkdirSync(webDir, { recursive: true })
            const manifest = join(webDir, 'embeddedAssets.generated.ts')
            const original = 'export const embeddedAssets = [{ path: "keep-me.js" }];\n'
            writeFileSync(manifest, original)

            await expect(withStubEmbeddedAssets(root, async () => {
                throw new Error('compile boom')
            })).rejects.toThrow('compile boom')

            expect(readFileSync(manifest, 'utf8')).toBe(original)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})

describe('fingerprintArtifactInputs / isArtifactCacheFresh', () => {
    it('changes when cli source changes at the same package version', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')

            const before = fingerprintArtifactInputs(root)
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 2\n')
            const after = fingerprintArtifactInputs(root)
            expect(before).not.toBe(after)
            expect(before).toHaveLength(64)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('treats legacy metas without sourceFingerprint as stale', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-artifact-legacy-'))
        try {
            const path = join(dir, 'hapi-0.25.1-linux-x64')
            writeFileSync(path, 'bytes')
            const legacy = {
                version: '0.25.1',
                platform: 'linux',
                arch: 'x64',
                path,
                sha256: 'abc',
                sizeBytes: 5,
            } as ArtifactMeta
            expect(isArtifactCacheFresh(legacy, 'deadbeef')).toBe(false)
            expect(isArtifactCacheFresh({ ...legacy, sourceFingerprint: 'deadbeef' }, 'deadbeef')).toBe(true)
            expect(isArtifactCacheFresh({ ...legacy, sourceFingerprint: 'deadbeef' }, 'cafebabe')).toBe(false)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
