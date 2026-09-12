import { describe, expect, it } from 'vitest'
import {
    collapseSpelledLetterRuns,
    normalizeSearchDictation,
    stripDictationTrailingPunctuation
} from './normalizeSearchDictation'

describe('normalizeSearchDictation', () => {
    it('strips trailing sentence punctuation', () => {
        expect(stripDictationTrailingPunctuation('Jessica.')).toBe('Jessica')
        expect(stripDictationTrailingPunctuation('hello!?')).toBe('hello')
    })

    it('joins hyphenated spelled letters', () => {
        expect(collapseSpelledLetterRuns('E-N-O')).toBe('ENO')
        expect(collapseSpelledLetterRuns('ENO PH-O')).toBe('ENO PHO')
        expect(collapseSpelledLetterRuns('P-H-O-T-O')).toBe('PHOTO')
    })

    it('joins space-separated spelled letters', () => {
        expect(collapseSpelledLetterRuns('E N O')).toBe('ENO')
        expect(collapseSpelledLetterRuns('P H O')).toBe('PHO')
        expect(collapseSpelledLetterRuns('E N O P H O')).toBe('ENOPHO')
    })

    it('joins dotted spelled letters', () => {
        expect(collapseSpelledLetterRuns('E.N.O')).toBe('ENO')
        expect(collapseSpelledLetterRuns('E. N. O.')).toBe('ENO')
    })

    it('does not glue ordinary words or a lone article', () => {
        expect(collapseSpelledLetterRuns('a cat')).toBe('a cat')
        expect(collapseSpelledLetterRuns('find chicken cam')).toBe('find chicken cam')
        expect(collapseSpelledLetterRuns('co-author')).toBe('co-author')
    })

    it('runs collapse then strip for the search pipeline', () => {
        expect(normalizeSearchDictation('  E-N-O.  ')).toBe('ENO')
        expect(normalizeSearchDictation('ENO PH-O.')).toBe('ENO PHO')
        expect(normalizeSearchDictation('ENO PH-O-...')).toBe('ENO PHO')
        expect(normalizeSearchDictation('Jessica.')).toBe('Jessica')
    })
})
