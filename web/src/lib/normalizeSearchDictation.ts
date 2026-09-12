/**
 * Search-box dictation cleanup. STT often formats spelled letters with
 * hyphens/spaces ("E-N-O", "P H O") and trailing sentence punctuation
 * ("Jessica.") — both break substring / FTS matching.
 */

/** Trailing `.`/`!`/`?` from on-device STT is never search intent. */
export function stripDictationTrailingPunctuation(text: string): string {
    return text.replace(/[.!?]+\s*$/, '')
}

function collapseHyphenatedSpelling(run: string): string {
    const parts = run.replace(/-+$/g, '').split('-').filter(Boolean)
    if (parts.length < 2) return run.replace(/-+$/g, '')
    // Pure spelling: E-N-O
    if (parts.every((part) => part.length === 1)) {
        return parts.join('')
    }
    // STT sometimes glues two letters then hyphenates the rest: PH-O → PHO
    if (parts.some((part) => part.length === 1) && parts.every((part) => part.length <= 2)) {
        return parts.join('')
    }
    return run
}

/**
 * Collapse runs of single letters joined by hyphens, spaces, or dots into a
 * contiguous token: `E-N-O` / `E N O` / `E.N.O` → `ENO`. Leaves ordinary
 * words alone (`a cat`, `co-author` stay put).
 */
export function collapseSpelledLetterRuns(text: string): string {
    // Hyphenated spelling tokens (optional trailing hyphen from cut-off STT).
    let out = text.replace(
        /\b[A-Za-z]+(?:-[A-Za-z]+)*-?\b/g,
        (run) => (run.includes('-') ? collapseHyphenatedSpelling(run) : run)
    )
    // Dotted spelled letters: "E.N.O" / "E.N.O."
    out = out.replace(
        /\b[A-Za-z](?:\.[A-Za-z])+\.?/g,
        (run) => run.replace(/\./g, '')
    )
    // "E. N. O." — letter + dot + whitespace, repeated.
    out = out.replace(
        /\b[A-Za-z]\.(?:\s*[A-Za-z]\.)+/g,
        (run) => run.replace(/[.\s]+/g, '')
    )
    // Space-separated single letters (length ≥ 2): "E N O" → "ENO".
    out = out.replace(
        /\b[A-Za-z](?:\s+[A-Za-z])+\b/g,
        (run) => {
            const parts = run.trim().split(/\s+/)
            if (parts.every((part) => part.length === 1)) {
                return parts.join('')
            }
            return run
        }
    )
    return out
}

/** Full pipeline applied when search dictation commits a transcript. */
export function normalizeSearchDictation(text: string): string {
    return stripDictationTrailingPunctuation(
        collapseSpelledLetterRuns(text.trim()).replace(/[-]+$/g, '')
    )
}
