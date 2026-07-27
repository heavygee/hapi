import type { FileHandle } from 'node:fs/promises'
import { acquireRunnerLock, releaseRunnerLock } from '@/persistence'
import { logger } from '@/ui/logger'

/**
 * Hooks so RPC-driven self-upgrade can release/reacquire the runner lock the
 * same way mtime handoff does in run.ts — child cannot write runner.state.json
 * until the parent releases the lock.
 */
type HandoffLockHooks = {
    release: () => Promise<void>
    reacquire: () => Promise<boolean>
}

let hooks: HandoffLockHooks | null = null

export function registerRunnerHandoffLockHooks(next: HandoffLockHooks | null): void {
    hooks = next
}

export function createRunnerHandoffLockHooks(getHandle: () => FileHandle | null, setHandle: (handle: FileHandle | null) => void): HandoffLockHooks {
    return {
        release: async () => {
            const handle = getHandle()
            if (!handle) {
                return
            }
            await releaseRunnerLock(handle)
            setHandle(null)
        },
        reacquire: async () => {
            const reacquired = await acquireRunnerLock(60, 500)
            if (!reacquired) {
                return false
            }
            setHandle(reacquired)
            return true
        },
    }
}

export async function releaseRunnerLockForHandoff(): Promise<void> {
    if (!hooks) {
        logger.debug('[RUNNER HANDOFF] No lock hooks registered; child may block on lock')
        return
    }
    await hooks.release()
}

export async function reacquireRunnerLockAfterFailedHandoff(): Promise<boolean> {
    if (!hooks) {
        return false
    }
    return await hooks.reacquire()
}
