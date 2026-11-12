import { FeaturesPatchRequestSchema } from '@hapi/protocol'
import { Hono } from 'hono'
import { getConfiguration, type ConfigSource } from '../../configuration'
import type { WebAppEnv } from '../middleware/auth'

export type GithubPrAwarenessState = {
    enabled: boolean
    source: ConfigSource
}

export type FeaturesRouteDeps = {
    getGithubPrAwareness: () => GithubPrAwarenessState
    setGithubPrAwareness: (enabled: boolean) => Promise<void>
}

/**
 * Single source of truth for the flag, shared with the CLI router's
 * `GET /cli/features`. The CLI gates MCP `link_pr` on that endpoint and fails
 * closed on any non-2xx, so these two routes must not drift: if they ever
 * disagree the tool silently vanishes with nothing in the logs.
 */
export function readGithubPrAwareness(): GithubPrAwarenessState {
    const configuration = getConfiguration()
    return {
        enabled: configuration.githubPrAwareness,
        source: configuration.sources.githubPrAwareness
    }
}

function defaultDeps(): FeaturesRouteDeps {
    return {
        getGithubPrAwareness: readGithubPrAwareness,
        setGithubPrAwareness: async (enabled: boolean) => {
            await getConfiguration().setGithubPrAwareness(enabled)
        }
    }
}

export function createFeaturesRoutes(deps: FeaturesRouteDeps = defaultDeps()): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/features', (c) => {
        const githubPrAwareness = deps.getGithubPrAwareness()
        return c.json({
            githubPrAwareness: {
                enabled: githubPrAwareness.enabled,
                source: githubPrAwareness.source
            }
        })
    })

    app.patch('/features', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = FeaturesPatchRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const current = deps.getGithubPrAwareness()
        if (parsed.data.githubPrAwareness !== undefined) {
            if (current.source === 'env') {
                return c.json({
                    error: 'githubPrAwareness is pinned by HAPI_GITHUB_PR_AWARENESS',
                    code: 'feature_pinned_by_env'
                }, 409)
            }
            try {
                await deps.setGithubPrAwareness(parsed.data.githubPrAwareness)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to update features'
                if (message.includes('pinned by')) {
                    return c.json({ error: message, code: 'feature_pinned_by_env' }, 409)
                }
                return c.json({ error: message }, 500)
            }
        }

        const next = deps.getGithubPrAwareness()
        return c.json({
            githubPrAwareness: {
                enabled: next.enabled,
                source: next.source
            }
        })
    })

    return app
}
