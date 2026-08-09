import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'

/**
 * Local proof for peer-delivery attribution after resume (#1203).
 *
 * Hub GET never returns sessionCapability (namespace-token forge risk). The
 * create-time session tag is also absent from the public Session schema. Persist
 * both under HAPI_HOME so a legitimate resume can prove ownership on the CLI
 * socket (`sessionTag`) and attribute without waiting on a forgeable mint.
 */
const PeerSessionCredentialsSchema = z.object({
    sessionId: z.string().min(1),
    sessionTag: z.string().min(1),
    sessionCapability: z.string().min(1),
})

export type PeerSessionCredentials = z.infer<typeof PeerSessionCredentialsSchema>

function credentialsDir(): string {
    return join(configuration.happyHomeDir, 'peer-session-credentials')
}

function credentialsPath(sessionId: string): string {
    return join(credentialsDir(), `${sessionId}.json`)
}

export function savePeerSessionCredentials(credentials: PeerSessionCredentials): void {
    const parsed = PeerSessionCredentialsSchema.safeParse(credentials)
    if (!parsed.success) {
        logger.debug('[peer-cap] refusing to persist invalid peer session credentials')
        return
    }
    try {
        mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 })
        const path = credentialsPath(parsed.data.sessionId)
        writeFileSync(path, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        try {
            chmodSync(path, 0o600)
        } catch {
            // best-effort on platforms that ignore mode bits
        }
    } catch (error) {
        logger.debug('[peer-cap] failed to persist peer session credentials', error)
    }
}

export function loadPeerSessionCredentials(sessionId: string): PeerSessionCredentials | null {
    const id = sessionId.trim()
    if (!id) return null
    try {
        const raw = readFileSync(credentialsPath(id), 'utf8')
        const parsed = PeerSessionCredentialsSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) return null
        if (parsed.data.sessionId !== id) return null
        return parsed.data
    } catch {
        return null
    }
}
