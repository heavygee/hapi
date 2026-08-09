import { closeSync, readSync } from 'node:fs'

/**
 * Runner → CLI create-time tag channel for #1203 resume mint.
 *
 * Must NOT put the tag in process.env: Linux keeps the original execve environ
 * in /proc/<pid>/environ forever, and delete process.env[key] does not scrub it
 * (cold pass 2e-alt B1). Pass the tag on an inherited pipe (stdio fd 3); the CLI
 * reads once into memory and closes the fd.
 *
 * `HAPI_PEER_SESSION_TAG_FD` may appear in environ — it is only the fd number
 * (e.g. "3"), never the secret. Reading is gated on that flag so random open
 * fds (test runners, IPC) are not blocking-read.
 */
export const PEER_SESSION_TAG_FD = 3
export const HAPI_PEER_SESSION_TAG_FD_ENV = 'HAPI_PEER_SESSION_TAG_FD'

export function consumePeerSessionTagFromFd(): string | undefined {
    const raw = process.env[HAPI_PEER_SESSION_TAG_FD_ENV]?.trim()
    delete process.env[HAPI_PEER_SESSION_TAG_FD_ENV]
    if (!raw) {
        return undefined
    }
    const fd = Number(raw)
    if (!Number.isInteger(fd) || fd < 3) {
        return undefined
    }

    try {
        const chunks: Buffer[] = []
        const buf = Buffer.alloc(256)
        for (;;) {
            let n: number
            try {
                n = readSync(fd, buf, 0, buf.length, null)
            } catch {
                break
            }
            if (n <= 0) {
                break
            }
            chunks.push(Buffer.from(buf.subarray(0, n)))
            if (buf.subarray(0, n).includes(0x0a)) {
                break
            }
            if (Buffer.concat(chunks).length > 4096) {
                break
            }
        }
        try {
            closeSync(fd)
        } catch {
            // already closed / not open
        }
        const text = Buffer.concat(chunks).toString('utf8').split('\n')[0]?.trim()
        return text || undefined
    } catch {
        return undefined
    }
}
