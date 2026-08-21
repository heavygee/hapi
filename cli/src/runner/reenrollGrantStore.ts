import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from '@/configuration'

/**
 * File-backed reenroll grants were removed (#1473 Blocker / 410 endpoints).
 * Keep a wipe helper so leftover `runner-reenroll.grant.json` from older
 * runners does not linger under HAPI_HOME.
 */
export function clearReenrollGrant(): void {
    const base = join(configuration.happyHomeDir, 'runner-reenroll.grant.json')
    for (const path of [base, `${base}.pending`]) {
        if (existsSync(path)) {
            try {
                unlinkSync(path)
            } catch {
                // ignore
            }
        }
    }
}
