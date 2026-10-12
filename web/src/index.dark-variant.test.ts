import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard: Tailwind `dark:` must follow HAPI appearance (`data-theme`), not OS
 * prefers-color-scheme. Otherwise Light appearance + dark OS (Quest) yields
 * light-on-light (e.g. skew-banner NOTES). See heavygee/hapi#250.
 */
describe('Tailwind dark variant ↔ data-theme', () => {
    const css = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'index.css'),
        'utf8',
    )

    it('binds dark: to data-theme dark and oled', () => {
        expect(css).toMatch(
            /@custom-variant\s+dark\s*\(\s*&:where\(\s*\[data-theme=dark\].*\[data-theme=oled\].*\)\s*\)/,
        )
    })

    it('does not leave dark: on prefers-color-scheme alone (no custom-variant would)', () => {
        // Presence of the custom-variant is the override; also forbid an accidental
        // second media-based dark variant declaration in this file.
        expect(css).not.toMatch(/@custom-variant\s+dark\s*\(\s*&:where\(\s*\.dark/)
        expect(css.match(/@custom-variant\s+dark/g)?.length).toBe(1)
    })
})
