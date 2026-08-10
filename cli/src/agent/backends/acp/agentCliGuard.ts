import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { resolveHapiHomeDir } from '@/configuration';

/**
 * Cursor's `agent` CLI appears to allow only one active process at a time.
 * Spawning `agent --list-models` while `agent acp` is running terminates the ACP
 * child (SIGTERM / exit 143) and crashes the remote session.
 *
 * In-process ref counting covers RPC handlers in the same process; a HAPI_HOME
 * lock directory covers runner vs session child processes.
 *
 * Prefer recording the ACP child PID (not only the HAPI host PID) so stale
 * cleanup and logs attribute the real `agent` process. Register the lock
 * before spawn, and keep it held until stdio `close` — releasing on bare
 * `exit` opens a window where list-models can start another `agent`.
 */
let activeAcpTransportCount = 0;

export type AgentAcpGuardPidOptions = {
    /** Spawned `agent` child PID when known. */
    childPid?: number;
};

function normalizePid(pid: number | undefined): number | null {
    if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    return pid;
}

export function getAgentAcpLockDir(): string {
    return join(resolveHapiHomeDir(), 'locks', 'agent-acp-active');
}

function getAcpLockDir(): string {
    return getAgentAcpLockDir();
}

function getPidsDir(lockDir: string): string {
    return join(lockDir, 'pids');
}

function readLockPid(lockDir: string): number | null {
    const pidPath = join(lockDir, 'pid');
    if (!existsSync(pidPath)) {
        return null;
    }

    try {
        const raw = readFileSync(pidPath, 'utf8').trim();
        const pid = Number(raw);
        if (!Number.isInteger(pid) || pid <= 0) {
            return null;
        }
        return pid;
    } catch {
        return null;
    }
}

function readLockCount(lockDir: string): number {
    const countPath = join(lockDir, 'count');
    if (!existsSync(countPath)) {
        return 0;
    }

    try {
        const raw = readFileSync(countPath, 'utf8').trim();
        const count = Number(raw);
        if (!Number.isInteger(count) || count < 0) {
            return 0;
        }
        return count;
    } catch {
        return 0;
    }
}

function writeLockCount(lockDir: string, count: number): void {
    writeFileSync(join(lockDir, 'count'), String(Math.max(0, count)), 'utf8');
}

function writeChildPidHint(lockDir: string, childPid: number): void {
    writeFileSync(join(lockDir, 'child-pid'), String(childPid), 'utf8');
}

function clearChildPidHint(lockDir: string): void {
    try {
        rmSync(join(lockDir, 'child-pid'), { force: true });
    } catch {
        // Best effort.
    }
}

function addLockPid(lockDir: string, pid: number): void {
    const pidsDir = getPidsDir(lockDir);
    mkdirSync(pidsDir, { recursive: true });
    writeFileSync(join(pidsDir, String(pid)), String(pid), 'utf8');
}

function removeLockPid(lockDir: string, pid: number): void {
    try {
        rmSync(join(getPidsDir(lockDir), String(pid)), { force: true });
    } catch {
        // Best effort.
    }
}

function isLegacyLock(lockDir: string): boolean {
    return existsSync(join(lockDir, 'pid')) && !existsSync(join(lockDir, 'count'));
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Process exists but we lack permission to signal it.
        return code === 'EPERM';
    }
}

function removeAcpLockDir(): void {
    const lockDir = getAcpLockDir();
    if (!existsSync(lockDir)) {
        return;
    }
    try {
        rmSync(lockDir, { recursive: true, force: true });
    } catch {
        // Best effort — stale lock is preferable to killing a live ACP session.
    }
}

function reconcileRefcountLock(lockDir: string): boolean {
    const pidsDir = getPidsDir(lockDir);
    if (!existsSync(pidsDir)) {
        removeAcpLockDir();
        return false;
    }

    let liveCount = 0;
    for (const entry of readdirSync(pidsDir)) {
        const pid = Number(entry);
        if (!Number.isInteger(pid) || pid <= 0) {
            try {
                rmSync(join(pidsDir, entry), { force: true });
            } catch {
                // Best effort.
            }
            continue;
        }

        if (isProcessAlive(pid)) {
            liveCount += 1;
            continue;
        }

        try {
            rmSync(join(pidsDir, entry), { force: true });
        } catch {
            // Best effort.
        }
    }

    if (liveCount <= 0) {
        removeAcpLockDir();
        return false;
    }

    writeLockCount(lockDir, liveCount);
    return true;
}

/** Remove lock directories left behind by SIGKILL / crash / reboot. */
function clearStaleAcpLockIfNeeded(): void {
    const lockDir = getAcpLockDir();
    if (!existsSync(lockDir)) {
        return;
    }

    if (isLegacyLock(lockDir)) {
        const pid = readLockPid(lockDir);
        if (pid === null || !isProcessAlive(pid)) {
            removeAcpLockDir();
        }
        return;
    }

    reconcileRefcountLock(lockDir);
}

/**
 * Reserve / register the ACP lock. Call before spawn (no childPid) so
 * list-models cannot race the new `agent` process, then call
 * {@link recordActiveAcpChildPid} once the child PID is known.
 */
export function registerActiveAcpTransport(options?: AgentAcpGuardPidOptions): void {
    activeAcpTransportCount += 1;
    const lockDir = getAcpLockDir();
    const childPid = normalizePid(options?.childPid);
    try {
        mkdirSync(lockDir, { recursive: true });
        writeLockCount(lockDir, readLockCount(lockDir) + 1);
        // Always keep the HAPI host PID for crash/stale cleanup of the session
        // process; also record the ACP child when known.
        addLockPid(lockDir, process.pid);
        if (childPid !== null) {
            addLockPid(lockDir, childPid);
            writeChildPidHint(lockDir, childPid);
        }
    } catch {
        // Another process may have created the lock; in-process guard still applies.
    }
}

/** Upgrade a pre-spawn reservation with the real ACP child PID. */
export function recordActiveAcpChildPid(childPid: number): void {
    const pid = normalizePid(childPid);
    if (pid === null) {
        return;
    }
    const lockDir = getAcpLockDir();
    if (!existsSync(lockDir)) {
        return;
    }
    try {
        addLockPid(lockDir, pid);
        writeChildPidHint(lockDir, pid);
    } catch {
        // Best effort.
    }
}

export function unregisterActiveAcpTransport(options?: AgentAcpGuardPidOptions): void {
    activeAcpTransportCount = Math.max(0, activeAcpTransportCount - 1);

    const lockDir = getAcpLockDir();
    if (!existsSync(lockDir)) {
        return;
    }

    if (isLegacyLock(lockDir)) {
        if (activeAcpTransportCount <= 0) {
            removeAcpLockDir();
        }
        return;
    }

    try {
        const childPid = normalizePid(options?.childPid);
        if (childPid !== null) {
            removeLockPid(lockDir, childPid);
        }
        if (activeAcpTransportCount <= 0) {
            removeLockPid(lockDir, process.pid);
            clearChildPidHint(lockDir);
        }
        reconcileRefcountLock(lockDir);
    } catch {
        // Best effort.
    }
}

export function isAgentAcpTransportActive(): boolean {
    if (activeAcpTransportCount > 0) {
        return true;
    }
    clearStaleAcpLockIfNeeded();
    const lockDir = getAcpLockDir();
    if (!existsSync(lockDir)) {
        return false;
    }

    if (isLegacyLock(lockDir)) {
        const pid = readLockPid(lockDir);
        return pid !== null && isProcessAlive(pid);
    }

    return readLockCount(lockDir) > 0;
}

/** Debug attribution for exit / list-models races (PID, lock dir, activity). */
export function describeAgentAcpGuardState(childPid?: number | null): {
    lockDir: string;
    inProcessCount: number;
    childPid: number | null;
    childAlive: boolean | null;
    guardActive: boolean;
} {
    const pid = normalizePid(childPid ?? undefined);
    return {
        lockDir: getAgentAcpLockDir(),
        inProcessCount: activeAcpTransportCount,
        childPid: pid,
        childAlive: pid === null ? null : isProcessAlive(pid),
        guardActive: isAgentAcpTransportActive()
    };
}

export function _resetAgentCliGuardForTests(): void {
    activeAcpTransportCount = 0;
    removeAcpLockDir();
}
