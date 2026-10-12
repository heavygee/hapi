import { beforeEach, describe, expect, it } from 'vitest'
import {
    appendTerminalExcerptToComposerDraft,
    extractTerminalExcerpt,
    formatTerminalExcerpt,
    type TerminalTextSource,
} from './terminal-composer'
import { getDraft, saveDraft } from '@/lib/composer-drafts'

function makeTerminal(options: {
    selection?: string
    lines?: string[]
}): TerminalTextSource {
    const lines = options.lines ?? []
    return {
        hasSelection: () => Boolean(options.selection && options.selection.length > 0),
        getSelection: () => options.selection ?? '',
        buffer: {
            active: {
                length: lines.length,
                getLine: (index: number) => {
                    const value = lines[index]
                    if (value === undefined) return undefined
                    return {
                        translateToString: () => value,
                    }
                },
            },
        },
    }
}

describe('terminal-composer', () => {
    beforeEach(() => {
        window.sessionStorage.clear()
    })

    it('prefers a nonempty selection over the buffer', () => {
        const excerpt = extractTerminalExcerpt(
            makeTerminal({
                selection: 'selected line',
                lines: ['full', 'buffer'],
            })
        )
        expect(excerpt).toEqual({ kind: 'selection', text: 'selected line' })
    })

    it('falls back to the buffer when selection is whitespace-only', () => {
        const excerpt = extractTerminalExcerpt(
            makeTerminal({
                selection: '   \n',
                lines: ['hello', 'world', ''],
            })
        )
        expect(excerpt).toEqual({ kind: 'buffer', text: 'hello\nworld' })
    })

    it('returns null for an empty buffer', () => {
        expect(extractTerminalExcerpt(makeTerminal({ lines: ['', '  '] }))).toBeNull()
    })

    it('formats selection and buffer excerpts', () => {
        expect(formatTerminalExcerpt({ kind: 'selection', text: 'x' })).toBe(
            '### Terminal selection\n\n```text\nx\n```'
        )
        expect(formatTerminalExcerpt({ kind: 'buffer', text: 'y' })).toBe(
            '### Terminal output\n\n```text\ny\n```'
        )
    })

    it('appends to an existing composer draft', () => {
        saveDraft('term-composer-existing', 'please look')
        appendTerminalExcerptToComposerDraft('term-composer-existing', {
            kind: 'buffer',
            text: 'ls\nfile.txt',
        })
        expect(getDraft('term-composer-existing')).toBe(
            'please look\n\n### Terminal output\n\n```text\nls\nfile.txt\n```'
        )
    })

    it('writes a new draft when none exists', () => {
        appendTerminalExcerptToComposerDraft('term-composer-empty', {
            kind: 'selection',
            text: 'REFUSE: lane B',
        })
        expect(getDraft('term-composer-empty')).toBe(
            '### Terminal selection\n\n```text\nREFUSE: lane B\n```'
        )
    })
})
