import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
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

    it('prefers a fresh .exe over a stale extensionless outPath on same-version rebuild', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-artifact-stale-'))
        try {
            const outPath = join(dir, 'hapi-0.25.1-win32-x64')
            writeFileSync(outPath, 'OLD-PE-bytes')
            writeFileSync(`${outPath}.exe`, 'NEW-PE-bytes')
            const produced = normalizeCompiledArtifactPath(outPath, 'win32')
            expect(produced).toBe(outPath)
            expect(readFileSync(produced, 'utf8')).toBe('NEW-PE-bytes')
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

    it('keeps the backup when restore fails so the original is not destroyed', async () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-stub-assets-bak-'))
        try {
            const webDir = join(root, 'hub', 'src', 'web')
            mkdirSync(webDir, { recursive: true })
            const manifest = join(webDir, 'embeddedAssets.generated.ts')
            const original = 'export const embeddedAssets = [{ path: "real.js" }];\n'
            writeFileSync(manifest, original)

            await expect(withStubEmbeddedAssets(root, async () => 'ok', {
                restoreFromBackup: () => {
                    throw new Error('EPERM: restore failed')
                },
            })).rejects.toThrow(/Failed to restore embedded asset manifest/)

            expect(readFileSync(manifest, 'utf8')).toContain('intentionally contains no embedded assets')
            const backups = readdirSync(webDir).filter((name) => name.includes('.bak'))
            expect(backups).toHaveLength(1)
            expect(readFileSync(join(webDir, backups[0]!), 'utf8')).toBe(original)
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
            mkdirSync(join(root, 'hub', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export {}\n')
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

    it('changes when hub source changes at the same package version', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-hub-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'hub', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export const hub = 1\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')

            const before = fingerprintArtifactInputs(root)
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export const hub = 2\n')
            expect(fingerprintArtifactInputs(root)).not.toBe(before)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('changes when an embedded tool asset is replaced', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-tool-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'cli', 'tools', 'archives'), { recursive: true })
            mkdirSync(join(root, 'hub', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export {}\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')
            const archive = join(root, 'cli', 'tools', 'archives', 'ripgrep-x64-linux.tar.gz')
            writeFileSync(archive, 'old-bytes')

            const before = fingerprintArtifactInputs(root)
            writeFileSync(archive, 'new-bytes-longer')
            expect(fingerprintArtifactInputs(root)).not.toBe(before)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('is unchanged by an mtime-only touch of identical tool bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-mtime-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'cli', 'tools', 'archives'), { recursive: true })
            mkdirSync(join(root, 'hub', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export {}\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')
            const archive = join(root, 'cli', 'tools', 'archives', 'ripgrep-x64-linux.tar.gz')
            writeFileSync(archive, 'same-bytes')

            const before = fingerprintArtifactInputs(root)
            utimesSync(archive, new Date(2000, 0, 1), new Date(2000, 0, 1))
            expect(fingerprintArtifactInputs(root)).toBe(before)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('ignores hub embeddedAssets.generated.ts which compile stubs out', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-stub-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'hub', 'src', 'web'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export {}\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')
            const manifest = join(root, 'hub', 'src', 'web', 'embeddedAssets.generated.ts')
            writeFileSync(manifest, 'export const embeddedAssets = [{ path: "a.js" }];\n')

            const before = fingerprintArtifactInputs(root)
            writeFileSync(manifest, 'export const embeddedAssets = [{ path: "b.js" }];\n')
            expect(fingerprintArtifactInputs(root)).toBe(before)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('ignores downloaded tunwg platform caches under shared/tools', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-artifact-tunwg-fp-'))
        try {
            mkdirSync(join(root, 'cli', 'src'), { recursive: true })
            mkdirSync(join(root, 'hub', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'src'), { recursive: true })
            mkdirSync(join(root, 'shared', 'tools', 'tunwg'), { recursive: true })
            writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'hub', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'shared', 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.25.1' }))
            writeFileSync(join(root, 'cli', 'src', 'bootstrap.ts'), 'export const x = 1\n')
            writeFileSync(join(root, 'hub', 'src', 'startHub.ts'), 'export {}\n')
            writeFileSync(join(root, 'shared', 'src', 'index.ts'), 'export {}\n')
            writeFileSync(join(root, 'shared', 'tools', 'tunwg', 'tunwg-linux-amd64'), 'linux-bytes')

            const before = fingerprintArtifactInputs(root)
            writeFileSync(join(root, 'shared', 'tools', 'tunwg', 'tunwg-windows-amd64.exe'), 'win-bytes')
            expect(fingerprintArtifactInputs(root)).toBe(before)
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
