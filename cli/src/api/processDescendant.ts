import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Walk parent-pid chain. Used to authorize session-local brokers so same-UID
 * sibling sessions cannot call another session's parent (#1203 pass 2d B3).
 */
export function isProcessDescendant(childPid: number, ancestorPid: number): boolean {
    if (!Number.isInteger(childPid) || !Number.isInteger(ancestorPid)) {
        return false
    }
    if (childPid === ancestorPid) {
        return true
    }
    let current = childPid
    for (let i = 0; i < 128; i++) {
        if (current <= 1) {
            return false
        }
        const ppid = readPpid(current)
        if (ppid === null) {
            return false
        }
        if (ppid === ancestorPid) {
            return true
        }
        if (ppid === current) {
            return false
        }
        current = ppid
    }
    return false
}

function readPpid(pid: number): number | null {
    if (process.platform === 'linux') {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
            const closeParen = stat.lastIndexOf(')')
            if (closeParen < 0) {
                return null
            }
            // After "pid (comm)": state, ppid, ...
            const rest = stat.slice(closeParen + 2).trimStart().split(/\s+/)
            const ppid = Number(rest[1])
            return Number.isFinite(ppid) ? ppid : null
        } catch {
            return null
        }
    }

    if (process.platform === 'darwin') {
        try {
            const out = execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim()
            const ppid = Number(out)
            return Number.isFinite(ppid) ? ppid : null
        } catch {
            return null
        }
    }

    return null
}
