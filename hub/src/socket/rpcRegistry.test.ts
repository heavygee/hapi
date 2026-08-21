import { describe, expect, it } from 'bun:test'
import { RpcRegistry } from './rpcRegistry'

function fakeSocket(id: string) {
    return { id } as any
}

describe('RpcRegistry', () => {
    it('refuses overwrite while another socket owns the method', () => {
        const reg = new RpcRegistry()
        const a = fakeSocket('sock-a')
        const b = fakeSocket('sock-b')
        expect(reg.register(a, 'machine-1:spawn-happy-session')).toBe(true)
        expect(reg.register(b, 'machine-1:spawn-happy-session')).toBe(false)
        expect(reg.getSocketIdForMethod('machine-1:spawn-happy-session')).toBe('sock-a')
    })

    it('allows re-register after the owner unregisters', () => {
        const reg = new RpcRegistry()
        const a = fakeSocket('sock-a')
        const b = fakeSocket('sock-b')
        expect(reg.register(a, 'machine-1:spawn-happy-session')).toBe(true)
        reg.unregisterAll(a)
        expect(reg.register(b, 'machine-1:spawn-happy-session')).toBe(true)
        expect(reg.getSocketIdForMethod('machine-1:spawn-happy-session')).toBe('sock-b')
    })

    it('allows the same socket to re-register its own method', () => {
        const reg = new RpcRegistry()
        const a = fakeSocket('sock-a')
        expect(reg.register(a, 'm')).toBe(true)
        expect(reg.register(a, 'm')).toBe(true)
        expect(reg.getSocketIdForMethod('m')).toBe('sock-a')
    })
})
