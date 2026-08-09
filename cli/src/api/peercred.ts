import type { Socket } from 'node:net'

export type PeerCredentials = {
    pid: number
    uid: number
    gid: number
}

export type PeerCredReader = (socket: Socket) => PeerCredentials | null

/**
 * Read Linux SO_PEERCRED (pid/uid/gid) for an AF_UNIX peer.
 * Returns null on unsupported platforms or when the fd is unavailable.
 */
export const readUnixPeerCredentials: PeerCredReader = (socket) => {
    try {
        const handle = (socket as unknown as { _handle?: { fd?: number } })._handle
        const fd = handle?.fd
        if (typeof fd !== 'number' || fd < 0) {
            return null
        }
        // bun:ffi is available in the CLI runtime; vitest may stub this module.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { dlopen, suffix, ptr } = require('bun:ffi') as typeof import('bun:ffi')
        const libc = dlopen(`libc.${suffix}`, {
            getsockopt: {
                args: ['i32', 'i32', 'i32', 'ptr', 'ptr'] as const,
                returns: 'i32',
            },
        })
        const SOL_SOCKET = 1
        const SO_PEERCRED = 17
        const cred = new Int32Array(3) // pid, uid, gid
        const len = new Uint32Array([12])
        const rc = libc.symbols.getsockopt(fd, SOL_SOCKET, SO_PEERCRED, ptr(cred), ptr(len))
        if (rc !== 0) {
            return null
        }
        const pid = cred[0]!
        const uid = cred[1]!
        const gid = cred[2]!
        if (!Number.isInteger(pid) || pid <= 0) {
            return null
        }
        return { pid, uid, gid }
    } catch {
        return null
    }
}
