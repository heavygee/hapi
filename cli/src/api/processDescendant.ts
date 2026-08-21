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

/** Exported for unit tests (#1473 Windows broker). */
export function readPpid(pid: number): number | null {
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

    if (process.platform === 'win32') {
        return readPpidWindows(pid)
    }

    return null
}

/**
 * Parent PID via Toolhelp snapshot (#1473 Major — Windows broker auth).
 * Falls back to CIM if FFI is unavailable.
 */
function readPpidWindows(pid: number): number | null {
    const viaToolhelp = readPpidWindowsToolhelp(pid)
    if (viaToolhelp !== null) {
        return viaToolhelp
    }
    try {
        const out = execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
            ],
            {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5_000,
                windowsHide: true,
            }
        ).trim()
        const ppid = Number(out)
        return Number.isFinite(ppid) && ppid > 0 ? ppid : null
    } catch {
        return null
    }
}

function readPpidWindowsToolhelp(pid: number): number | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { dlopen, ptr } = require('bun:ffi') as typeof import('bun:ffi')
        const TH32CS_SNAPPROCESS = 0x00000002
        // PROCESSENTRY32W: th32ParentProcessID follows ULONG_PTR th32DefaultHeapID.
        const parentOffset = process.arch === 'ia32' ? 24 : 32
        const entrySize = process.arch === 'ia32' ? 556 : 568
        const kernel32 = dlopen('kernel32.dll', {
            CreateToolhelp32Snapshot: {
                args: ['u32', 'u32'] as const,
                returns: 'ptr',
            },
            Process32FirstW: {
                args: ['ptr', 'ptr'] as const,
                returns: 'i32',
            },
            Process32NextW: {
                args: ['ptr', 'ptr'] as const,
                returns: 'i32',
            },
            CloseHandle: {
                args: ['ptr'] as const,
                returns: 'i32',
            },
        })
        const snapshot = kernel32.symbols.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        // INVALID_HANDLE_VALUE is (HANDLE)-1; bun:ffi may surface null/0 on failure.
        if (snapshot == null || Number(snapshot) === -1 || Number(snapshot) === 0) {
            return null
        }
        try {
            const entry = Buffer.alloc(entrySize)
            entry.writeUInt32LE(entrySize, 0)
            if (!kernel32.symbols.Process32FirstW(snapshot, ptr(entry))) {
                return null
            }
            for (;;) {
                const processId = entry.readUInt32LE(8)
                const parentProcessId = entry.readUInt32LE(parentOffset)
                if (processId === pid) {
                    return parentProcessId > 0 ? parentProcessId : null
                }
                if (!kernel32.symbols.Process32NextW(snapshot, ptr(entry))) {
                    return null
                }
            }
        } finally {
            kernel32.symbols.CloseHandle(snapshot)
        }
    } catch {
        return null
    }
}
