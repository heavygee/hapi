#!/usr/bin/env bun
/**
 * Locks #921-class marker derivation: soup tree must expose /garden; feat-only must not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectSoupMarkersFromSource } from './verify-soup-web-dist.mjs'

function writeTree(webSrc, files) {
    for (const [rel, content] of Object.entries(files)) {
        const p = join(webSrc, rel)
        mkdirSync(join(p, '..'), { recursive: true })
        writeFileSync(p, content)
    }
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'soup-markers-'))
try {
    const soupSrc = join(tmpRoot, 'soup/web/src')
    writeTree(soupSrc, {
        'router.tsx': "export const r = { path: '/garden' }",
        'garden/GardenPage.tsx': 'export function GardenPage() {}',
        'lib/scratchlist.ts': 'export const x = 1',
        'test/fixture.ts': '// upstream test dir — not a soup marker',
        'utils/helpers.ts': '// shared utils — not a soup marker',
    })

    const soupMarkers = collectSoupMarkersFromSource(soupSrc)
    if (!soupMarkers.includes('/garden')) throw new Error('expected /garden marker from soup tree')
    if (!soupMarkers.includes('garden')) throw new Error('expected garden namespace marker')
    if (!soupMarkers.includes('scratchlist')) throw new Error('expected scratchlist marker')
    if (soupMarkers.includes('test')) throw new Error('test/ must not produce marker')
    if (soupMarkers.includes('utils')) throw new Error('utils/ must not produce marker')

    const featSrc = join(tmpRoot, 'feat/web/src')
    writeTree(featSrc, {
        'router.tsx': "export const r = { path: '/sessions' }",
        'lib/app.ts': 'export const app = 1',
        'test/fixture.ts': 'export const t = 1',
    })

    const featMarkers = collectSoupMarkersFromSource(featSrc)
    if (featMarkers.includes('/garden')) {
        throw new Error('feat-only tree must not derive /garden — rollback detection would be blind')
    }
    if (featMarkers.includes('garden')) {
        throw new Error('feat-only tree must not derive garden namespace marker')
    }

    console.log('verify-soup-markers.test.mjs: OK')
} finally {
    rmSync(tmpRoot, { recursive: true, force: true })
}
