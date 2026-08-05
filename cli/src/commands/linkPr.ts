import axios from 'axios'
import chalk from 'chalk'
import { parseGithubPrInput } from '@hapi/protocol'
import { buildAttachedGithubPrRefs } from '@hapi/protocol/attachGithubPrRef'
import type { ExternalRef } from '@hapi/protocol'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'
import type { CommandDefinition } from './types'

async function putExternalRefs(sessionId: string, externalRefs: ExternalRef[]) {
    const token = getAuthToken()
    const response = await axios.put(
        `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/external-refs`,
        { externalRefs },
        {
            headers: buildHubRequestHeaders({
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }),
            timeout: 60_000,
            validateStatus: () => true
        }
    )
    return response
}

export const linkPrCommand: CommandDefinition = {
    name: 'link-pr',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        const input = commandArgs[0]
        if (!input || commandArgs.includes('--help') || commandArgs.includes('-h')) {
            console.log('Usage: hapi link-pr <url|owner/repo#N>')
            console.log('Requires HAPI_SESSION_ID (exported into agent shells) and CLI_API_TOKEN.')
            console.log('Hub setting githubPrAwareness must be enabled.')
            console.log('Classifies PR health into the chip on attach (Meta batch / gh).')
            process.exit(input ? 0 : 2)
        }

        const sessionId = process.env[HAPI_SESSION_ID_ENV]?.trim()
        if (!sessionId) {
            console.error(chalk.red('Error:'), `${HAPI_SESSION_ID_ENV} is not set (run inside a HAPI session).`)
            process.exit(2)
        }

        const parsed = parseGithubPrInput(input)
        if (!parsed.ok) {
            console.error(chalk.red('Error:'), parsed.error)
            process.exit(2)
        }

        try {
            // Hub preserveGithubPrStatusCache keeps prior status if classify fails
            // on an idempotent same-PR re-link (identity-only PUT).
            const externalRefs = await buildAttachedGithubPrRefs({
                repo: parsed.repo,
                number: parsed.number,
                role: 'primary',
                source: 'agent',
                linkedAt: Date.now(),
                existingRefs: []
            })

            const response = await putExternalRefs(sessionId, externalRefs)
            if (response.status === 403) {
                console.error(chalk.red('Error:'), 'GitHub PR awareness is disabled on the hub (enable in Settings → General).')
                process.exit(1)
            }
            if (response.status < 200 || response.status >= 300) {
                const message = typeof response.data?.error === 'string'
                    ? response.data.error
                    : `HTTP ${response.status}`
                console.error(chalk.red('Error:'), message)
                process.exit(1)
            }
            const status = (externalRefs[0] as { status?: string } | undefined)?.status
            const suffix = status ? ` (chip ${status})` : ' (chip status pending Meta/gh)'
            console.log(chalk.green(`Linked ${parsed.repo}#${parsed.number} to session ${sessionId}${suffix}`))
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'request failed')
            process.exit(1)
        }
    }
}
