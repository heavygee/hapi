import { describe, expect, it } from 'bun:test'
import {
    buildDisplayLinksPayload,
    isDisplayableHttpHref,
    parseDisplayLinksInput,
    safeParseDisplayLinksInput,
} from './displayLinks'

describe('isDisplayableHttpHref', () => {
    it('accepts a landmine URL built by concatenation without rewriting bytes', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        expect(href).toBe('https://github.com/tiann/hapi/issues/1516')
        expect(isDisplayableHttpHref(href)).toBe(true)
    })

    it('accepts http and https', () => {
        expect(isDisplayableHttpHref('https://hapi-gc-oos.forest-adder.ts.net/sessions/abc')).toBe(true)
        expect(isDisplayableHttpHref('http://example.com/path')).toBe(true)
    })

    it.each([
        'javascript:alert(1)',
        'data:text/html,xss',
        'vbscript:msgbox(1)',
        'file:///tmp/secret',
        'mailto:ops@example.com',
        '/relative/path',
        'not a url',
        '',
    ])('rejects %s', (href) => {
        expect(isDisplayableHttpHref(href)).toBe(false)
    })

    it('rejects encoded javascript bypasses', () => {
        expect(isDisplayableHttpHref('javascript%3Aalert(1)')).toBe(false)
        expect(isDisplayableHttpHref('jav%61script:alert(1)')).toBe(false)
    })
})

describe('parseDisplayLinksInput', () => {
    it('round-trips a concatenated landmine href as stored bytes', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        const urls = parseDisplayLinksInput([{ href, title: 'Issue 1516' }])
        expect(urls).toEqual([{ href: 'https://github.com/tiann/hapi/issues/1516', title: 'Issue 1516' }])
        expect(urls[0]?.href).toBe(href)
    })

    it('accepts a bare href string in the urls array', () => {
        const href = 'https://example.com/a'
        expect(parseDisplayLinksInput([href])).toEqual([{ href }])
    })

    it('omits empty titles rather than storing blanks', () => {
        expect(parseDisplayLinksInput([{ href: 'https://example.com', title: '  ' }])).toEqual([
            { href: 'https://example.com' },
        ])
    })

    it('throws when urls is missing or empty', () => {
        expect(() => parseDisplayLinksInput(undefined)).toThrow(/urls/)
        expect(() => parseDisplayLinksInput([])).toThrow(/at least one/)
    })

    it('throws on deny-scheme hrefs instead of rewriting them', () => {
        expect(() => parseDisplayLinksInput([{ href: 'javascript:alert(1)' }])).toThrow(/rejected/)
    })
})

describe('safeParseDisplayLinksInput', () => {
    it('drops invalid entries instead of throwing (untrusted stored payloads)', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        expect(safeParseDisplayLinksInput([
            { href: 'javascript:alert(1)' },
            { href },
            { href: 'not-a-url' },
        ])).toEqual([{ href }])
    })

    it('returns [] for non-arrays', () => {
        expect(safeParseDisplayLinksInput(null)).toEqual([])
        expect(safeParseDisplayLinksInput({ href: 'https://example.com' })).toEqual([])
    })
})

describe('buildDisplayLinksPayload', () => {
    it('stores caller href bytes on the wire payload', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        const payload = buildDisplayLinksPayload({
            urls: [{ href, title: 'display_links' }],
            id: 'link-1',
        })
        expect(payload.type).toBe('display-links')
        expect(payload.urls[0]?.href).toBe(href)
        expect(JSON.stringify(payload)).toContain('tiann/hapi')
        expect(JSON.stringify(payload)).not.toContain('tian/hapi')
    })
})
