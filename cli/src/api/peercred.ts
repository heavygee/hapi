import type { Socket } from 'node:net'

export type PeerCredentials = {
    pid: number
    uid: number
    gid: number
}

export type PeerCredReader = (socket: Socket) => PeerCredentials | null

const GETSOCKOPT_FFI = {
    args: ['i32', 'i32', 'i32', 'ptr', 'ptr'] as const,
    returns: 'i32',
} as const

const GETPEEREID_FFI = {
    args: ['i32', 'ptr', 'ptr'] as const,
    returns: 'i32',
} as const

/**
 * Read AF_UNIX peer credentials (pid/uid/gid).
 * Linux: SO_PEERCRED via libc.so.6. macOS: getpeereid + LOCAL_PEERPID.
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

        if (process.platform === 'linux') {
            // Load only Linux symbols — bundling Darwin getpeereid fails dlopen
            // on glibc (Codex #1473 Major). Prefer SONAME libc.so.6 over libc.so
            // (bun resolves the latter relative to cwd).
            const libc = dlopen('libc.so.6', {
                getsockopt: GETSOCKOPT_FFI,
            })
            // SOL_SOCKET=1 / SO_PEERCRED=17 on x86_64 and aarch64 Linux.
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
        }

        if (process.platform === 'darwin') {
            const libc = dlopen(`libc.${suffix}`, {
                getsockopt: GETSOCKOPT_FFI,
                getpeereid: GETPEEREID_FFI,
            })
            // SOL_LOCAL=0, LOCAL_PEERPID=2 (Apple); uid/gid via getpeereid.
            const SOL_LOCAL = 0
            const LOCAL_PEERPID = 2
            const uidBuf = new Uint32Array(1)
            const gidBuf = new Uint32Array(1)
            if (libc.symbols.getpeereid(fd, ptr(uidBuf), ptr(gidBuf)) !== 0) {
                return null
            }
            const pidBuf = new Int32Array(1)
            const len = new Uint32Array([4])
            const rc = libc.symbols.getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, ptr(pidBuf), ptr(len))
            if (rc !== 0) {
                return null
            }
            const pid = pidBuf[0]!
            if (!Number.isInteger(pid) || pid <= 0) {
                return null
            }
            return { pid, uid: uidBuf[0]!, gid: gidBuf[0]! }
        }

        return null
    } catch {
        return null
    }
}
