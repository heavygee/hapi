import { describe, expect, it } from 'vitest'
import { parseDisplayLinksArgs } from './displayLinks'

describe('parseDisplayLinksArgs', () => {
    it('treats a leading http(s) href as self-target', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        expect(parseDisplayLinksArgs([href, 'Issue 1516'])).toEqual({
            help: false,
            sessionArg: null,
            href,
            title: 'Issue 1516',
        })
    })

    it('parses session prefix + href + title', () => {
        expect(parseDisplayLinksArgs(['abc12345', 'https://example.com', 'Example'])).toEqual({
            help: false,
            sessionArg: 'abc12345',
            href: 'https://example.com',
            title: 'Example',
        })
    })

    it('parses self token', () => {
        expect(parseDisplayLinksArgs(['self', 'https://example.com'])).toEqual({
            help: false,
            sessionArg: 'self',
            href: 'https://example.com',
            title: undefined,
        })
    })

    it('parses --help', () => {
        expect(parseDisplayLinksArgs(['--help']).help).toBe(true)
    })

    it('throws when href is missing', () => {
        expect(() => parseDisplayLinksArgs([])).toThrow(/missing href/)
        expect(() => parseDisplayLinksArgs(['self'])).toThrow(/missing href/)
    })
})
