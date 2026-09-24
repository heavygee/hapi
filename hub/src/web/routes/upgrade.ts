import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { z } from 'zod'
import { FLEET_UPGRADE_POLICIES } from '@hapi/protocol/upgradeChannel'
import type { WebAppEnv } from '../middleware/auth'
import { ensureCliArtifact, findArtifactMetaBySha256 } from '../../upgrade/cliArtifact'
import { defaultHubPackageRoot, resolveUpgradeOffer } from '../../upgrade/resolveUpgradeOffer'
import {
    ensureSoupCliArtifact,
    preferPublishedSoupTip,
    readPublishedSoupTip,
    soupTipToUpgradeOffer,
} from '../../upgrade/soupArtifact'
import { getFleetUpgradePolicy, setFleetUpgradePolicy } from '../../upgrade/fleetUpgradePolicy'
import { getConfiguration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import type { SyncEngine } from '../../sync/syncEngine'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

/**
 * Web (JWT) routes: upgrade offer for the UI.
 */
export function createUpgradeRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/upgrade/offer', (c) => {
        const engine = getSyncEngine()
        const offer = engine?.getHubUpgradeOffer()
        if (!offer) {
            // Fallback for early boot / tests without a SyncEngine — still
            // resolves a channel/version without forcing a fingerprint walk
            // when the engine cache is available.
            let fallback = resolveUpgradeOffer({
                hubPackageRoot: defaultHubPackageRoot(),
                execPath: process.execPath,
            })
            if (fallback.channel === 'hub-artifact' && preferPublishedSoupTip()) {
                const tip = readPublishedSoupTip()
                if (tip) {
                    const soupOffer = soupTipToUpgradeOffer(
                        tip,
                        process.platform,
                        process.arch,
                        fallback,
                    )
                    if (soupOffer) {
                        fallback = soupOffer
                    }
                }
            }
            return c.json({ offer: fallback, policy: getFleetUpgradePolicy() })
        }
        return c.json({ offer, policy: getFleetUpgradePolicy() })
    })

    const policyBody = z.object({ policy: z.enum(FLEET_UPGRADE_POLICIES as unknown as [string, ...string[]]) })

    app.put('/upgrade/policy', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: 'Fleet upgrade policy is only available in the default namespace' }, 403)
        }
        const parsed = policyBody.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: 'Invalid policy' }, 400)
        }
        try {
            await setFleetUpgradePolicy(parsed.data.policy as (typeof FLEET_UPGRADE_POLICIES)[number])
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update fleet upgrade policy'
            return c.json({ error: message }, 500)
        }
        return c.json({ policy: getFleetUpgradePolicy() })
    })

    return app
}

type CliEnv = {
    Variables: {
        namespace: string
    }
}

/**
 * CLI-token routes: binary artifact download for runner-self-upgrade.
 * Mounted at `/cli` (same auth as other CLI HTTP routes).
 */
export function createUpgradeCliRoutes(): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('/upgrade/*', async (c, next) => {
        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }
        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }
        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const configuration = getConfiguration()
        const parsedToken = parseAccessToken(token)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid token' }, 401)
        }
        c.set('namespace', parsedToken.namespace)
        await next()
        return
    })

    app.get('/upgrade/cli-artifact', async (c) => {
        const config = getConfiguration()
        const version = c.req.query('version')
        const platform = c.req.query('platform') || process.platform
        const arch = c.req.query('arch') || process.arch

        const baseOffer = resolveUpgradeOffer({
            hubPackageRoot: defaultHubPackageRoot(),
            execPath: process.execPath,
        })
        let effectiveOffer = baseOffer
        if (baseOffer.channel === 'hub-artifact' && preferPublishedSoupTip()) {
            const tip = readPublishedSoupTip()
            if (tip) {
                const soupOffer = soupTipToUpgradeOffer(
                    tip,
                    platform,
                    arch,
                    baseOffer,
                )
                if (soupOffer) {
                    effectiveOffer = soupOffer
                }
            }
        }
        const targetVersion = version || effectiveOffer.targetVersion

        if (effectiveOffer.channel === 'off') {
            return c.json({ error: 'Fleet upgrade disabled' }, 403)
        }

        // Only serve the hub's current offer version — prevents arbitrary-version
        // compiles and keeps path tokens aligned with a known semver / soup tag.
        if (targetVersion !== effectiveOffer.targetVersion) {
            return c.json({ error: 'Unsupported artifact version' }, 400)
        }

        try {
            const wantedSha = c.req.query('sha256')
            if (wantedSha) {
                // Digest-pinned offer: serve the retained bytes only. Do not
                // rebuild — a newer generation would fail the runner's sha check.
                const retained = findArtifactMetaBySha256(wantedSha, config.dataDir)
                if (!retained || !existsSync(retained.path)) {
                    // Soup tip may not yet be mirrored into upgrade-artifacts —
                    // materialize on demand when the digest matches the tip.
                    if (
                        preferPublishedSoupTip()
                        && effectiveOffer.targetVersion.startsWith('hapi-soup-v')
                    ) {
                        const tip = readPublishedSoupTip()
                        if (tip && tip.tag === effectiveOffer.targetVersion) {
                            const meta = ensureSoupCliArtifact({
                                tip,
                                platform,
                                arch,
                                dataDir: config.dataDir,
                            })
                            if (meta.sha256 === wantedSha.trim().toLowerCase() && existsSync(meta.path)) {
                                return new Response(Bun.file(meta.path), {
                                    headers: {
                                        'Content-Type': 'application/octet-stream',
                                        'Content-Disposition': `attachment; filename="hapi-${meta.version}"`,
                                        'X-Hapi-Artifact-Sha256': meta.sha256,
                                        'X-Hapi-Artifact-Version': meta.version,
                                    },
                                })
                            }
                        }
                    }
                    return c.json({ error: 'Artifact not retained for digest' }, 404)
                }
                if (retained.version !== targetVersion) {
                    return c.json({ error: 'Artifact digest does not match offer version' }, 400)
                }
                return new Response(Bun.file(retained.path), {
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': `attachment; filename="hapi-${retained.version}"`,
                        'X-Hapi-Artifact-Sha256': retained.sha256,
                        'X-Hapi-Artifact-Version': retained.version,
                    },
                })
            }

            // Unpinned: soup tip → retain published bytes; else compile from tree.
            const tip = preferPublishedSoupTip()
                && targetVersion.startsWith('hapi-soup-v')
                ? readPublishedSoupTip()
                : null
            const meta = tip && tip.tag === targetVersion
                ? ensureSoupCliArtifact({
                    tip,
                    platform,
                    arch,
                    dataDir: config.dataDir,
                })
                : await ensureCliArtifact({
                    version: targetVersion,
                    platform,
                    arch,
                    dataDir: config.dataDir,
                    hubPackageRoot: defaultHubPackageRoot(),
                })
            if (!existsSync(meta.path)) {
                return c.json({ error: 'Artifact missing on disk' }, 404)
            }

            return new Response(Bun.file(meta.path), {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="hapi-${meta.version}"`,
                    'X-Hapi-Artifact-Sha256': meta.sha256,
                    'X-Hapi-Artifact-Version': meta.version,
                },
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to build artifact'
            if (message.startsWith('Invalid artifact ')) {
                return c.json({ error: message }, 400)
            }
            return c.json({ error: message }, 503)
        }
    })

    return app
}
