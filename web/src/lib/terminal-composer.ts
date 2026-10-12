import { getDraft, saveDraft } from '@/lib/composer-drafts'

/** Minimal xterm surface needed to extract plain text for the composer. */
export type TerminalTextSource = {
    hasSelection: () => boolean
    getSelection: () => string
    buffer: {
        active: {
            length: number
            getLine: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined
        }
    }
}

export type TerminalExcerptKind = 'selection' | 'buffer'

export type TerminalExcerpt = {
    kind: TerminalExcerptKind
    text: string
}

/** Prefer a nonempty selection; otherwise the active buffer including scrollback. */
export function extractTerminalExcerpt(terminal: TerminalTextSource): TerminalExcerpt | null {
    if (terminal.hasSelection()) {
        const selection = terminal.getSelection().replace(/\s+$/u, '')
        if (selection.trim().length > 0) {
            return { kind: 'selection', text: selection }
        }
    }

    const buffer = terminal.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (!line) continue
        lines.push(line.translateToString(true))
    }

    while (lines.length > 0 && lines[lines.length - 1]!.trim().length === 0) {
        lines.pop()
    }

    const text = lines.join('\n')
    if (text.trim().length === 0) {
        return null
    }
    return { kind: 'buffer', text }
}

export function formatTerminalExcerpt(excerpt: TerminalExcerpt): string {
    const label = excerpt.kind === 'selection' ? 'Terminal selection' : 'Terminal output'
    return `### ${label}\n\n\`\`\`text\n${excerpt.text}\n\`\`\``
}

/**
 * Append a terminal excerpt to a session's composer draft.
 *
 * The composer is unmounted on the terminal route, so callers persist here and
 * navigate back to chat; `useComposerDraft` restores the draft on mount.
 */
export function appendTerminalExcerptToComposerDraft(sessionId: string, excerpt: TerminalExcerpt): void {
    const block = formatTerminalExcerpt(excerpt)
    const existing = getDraft(sessionId).replace(/[ \t\r\n]+$/u, '')
    saveDraft(sessionId, existing.length > 0 ? `${existing}\n\n${block}` : block)
}
