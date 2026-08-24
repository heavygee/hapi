import { describe, expect, it } from 'vitest'
import { describeAbortClient } from './abortClient'

describe('describeAbortClient', () => {
    it('prefers x-hapi-surface and keeps user-agent', () => {
        const headers = new Headers({
            'x-hapi-surface': 'web',
            'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
        })
        expect(describeAbortClient(headers)).toBe(
            'web | Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
        )
    })

    it('falls back to user-agent only', () => {
        const headers = new Headers({
            'user-agent': 'Hapi/1.0 (Android)',
        })
        expect(describeAbortClient(headers)).toBe('Hapi/1.0 (Android)')
    })

    it('reports unknown when neither header is present', () => {
        expect(describeAbortClient(new Headers())).toBe('unknown')
    })
})
