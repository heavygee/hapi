import { describe, expect, it } from 'vitest'
import { interpolate } from './i18n-context'

describe('interpolate', () => {
    it('fills n and derives plural s for new-message pill', () => {
        expect(interpolate('{n} new message{s}', { n: 1 })).toBe('1 new message')
        expect(interpolate('{n} new message{s}', { n: 3 })).toBe('3 new messages')
    })

    it('leaves unknown placeholders intact', () => {
        expect(interpolate('hello {name}', { n: 1 })).toBe('hello {name}')
    })

    it('respects an explicit s override', () => {
        expect(interpolate('{n} new message{s}', { n: 1, s: 's' })).toBe('1 new messages')
    })
})
