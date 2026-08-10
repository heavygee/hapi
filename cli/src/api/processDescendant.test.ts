import { describe, expect, it } from 'vitest'
import { isProcessDescendant, readPpid } from './processDescendant'

describe('isProcessDescendant', () => {
    it('treats a pid as a descendant of itself', () => {
        expect(isProcessDescendant(process.pid, process.pid)).toBe(true)
    })

    it('rejects unrelated pids', () => {
        expect(isProcessDescendant(1, process.pid)).toBe(false)
    })

    it('recognizes the current process as a descendant of its parent', () => {
        const ppid = readPpid(process.pid)
        if (ppid === null) {
            // Platform without a PPID reader (should not happen on linux CI).
            return
        }
        expect(isProcessDescendant(process.pid, ppid)).toBe(true)
    })
})
