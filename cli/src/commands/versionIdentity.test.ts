import { describe, expect, it } from 'vitest'
import { formatVersionIdentity } from './versionIdentity'

describe('formatVersionIdentity', () => {
    it('prints semver on the probe line plus generation and skew', () => {
        const text = formatVersionIdentity({
            version: '0.27.3',
            generation: 'a3fed08d9127f8e371ca',
            hubTarget: 'a3fed08d9127f8e371ca',
            executable: 'C:\\Users\\HeavyGee\\.hapi\\bin\\hapi.exe',
        })
        expect(text).toContain('hapi version: 0.27.3')
        expect(text).toContain('generation: a3fed08d9127f8e371ca')
        expect(text).toContain('hub-target: a3fed08d9127f8e371ca')
        expect(text).toMatch(/skew: no\b/)
        expect(text).toContain('executable: C:\\Users\\HeavyGee\\.hapi\\bin\\hapi.exe')
    })

    it('reports skew yes when generation differs from hub target', () => {
        const text = formatVersionIdentity({
            version: '0.27.3',
            generation: 'd9abb275cb38a235502f',
            hubTarget: 'a3fed08d9127f8e371ca',
        })
        expect(text).toMatch(/skew: yes\b/)
    })

    it('reports unknown skew when hub target is missing', () => {
        const text = formatVersionIdentity({
            version: '0.27.3',
            generation: 'd9abb275cb38a235502f',
            hubTarget: null,
        })
        expect(text).toMatch(/skew: unknown\b/)
        expect(text).toContain('hub-target: unreachable')
    })

    it('labels soup hosts with no artifact marker', () => {
        const text = formatVersionIdentity({
            version: '0.27.3',
            generation: null,
            hubTarget: 'a3fed08d9127f8e371ca',
        })
        expect(text).toContain('generation: none (source/soup)')
        expect(text).toMatch(/skew: unknown\b/)
    })

    it('calls out PATH vs durable marker split on Windows', () => {
        const text = formatVersionIdentity({
            version: '0.27.3',
            generation: 'abc',
            hubTarget: 'abc',
            executable: 'C:\\Users\\HeavyGee\\.hapi\\bin\\hapi.exe',
            durableTarget: 'C:\\Users\\HeavyGee\\.hapi\\bin\\hapi-0.28.0-deadbeefdeadbeef.exe',
        })
        expect(text).toContain('durable-target:')
        expect(text).toContain('PATH hapi.exe may lag')
    })
})
