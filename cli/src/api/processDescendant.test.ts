import { describe, expect, it } from 'vitest'
import { isProcessDescendant } from './processDescendant'

describe('isProcessDescendant', () => {
    it('treats a pid as a descendant of itself', () => {
        expect(isProcessDescendant(process.pid, process.pid)).toBe(true)
    })

    it('rejects unrelated pids', () => {
        expect(isProcessDescendant(1, process.pid)).toBe(false)
    })
})
