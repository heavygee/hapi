import { closeSync, readSync } from 'node:fs'

/**
 * Runner → CLI create-time tag channel for #1203 resume mint.
 *
 * Must NOT put the tag in process.env: Linux keeps the original execve environ
 * in /proc/<pid>/environ forever (pass 2e-alt B1). Pass the tag on an inherited
 * pipe; the CLI drains it into memory and closes the fd **before any await**
 * so a same-UID sibling cannot race `/proc/<pid>/fd/N` during bootstrap
 * network calls (pass 2f B1).
 *
 * `HAPI_PEER_SESSION_TAG_FD` may appear in environ — it is only the fd number
 * (e.g. "3"), never the secret.
 */
export const PEER_SESSION_TAG_FD = 3
export const HAPI_PEER_SESSION_TAG_FD_ENV = 'HAPI_PEER_SESSION_TAG_FD'

let pendingTag: string | undefined
let drained = false

/**
 * Sync drain of the runner-provided tag fd into process memory, then close.
 * Safe to call repeatedly; only the first call reads the fd.
 * Invoked on module load so import of this module closes the race before
 * any later await in session bootstrap.
 */
export function drainPeerSessionTagFdEarly(): void {
    if (drained) {
        return
    }
    drained = true
    pendingTag = readTagFromEnvFd()
}

/**
 * Take the drained tag (once). Callers that need the mint proof should invoke
 * this after `drainPeerSessionTagFdEarly()` (including via module-load drain).
 */
export function consumePeerSessionTagFromFd(): string | undefined {
    drainPeerSessionTagFdEarly()
    const tag = pendingTag
    pendingTag = undefined
    return tag
}

function readTagFromEnvFd(): string | undefined {
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

// Close the /proc/fd race as soon as this module is first imported — before
// bootstrapExistingSession awaits ApiClient / getSession (pass 2f B1).
drainPeerSessionTagFdEarly()
