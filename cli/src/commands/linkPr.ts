import axios from 'axios'
import chalk from 'chalk'
import { buildGithubPrExternalRef, parseGithubPrInput, type ExternalRef } from '@hapi/protocol'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'
import type { CommandDefinition } from './types'

function authHeaders() {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
    })
}

async function getExternalRefs(sessionId: string): Promise<ExternalRef[]> {
    const response = await axios.get(
        `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/external-refs`,
        {
            headers: authHeaders(),
            timeout: 30_000,
            validateStatus: () => true
        }
    )
    if (response.status === 403) {
        throw Object.assign(new Error('GitHub PR awareness is disabled on the hub (enable in Settings → General).'), {
            status: 403
        })
    }
    if (response.status < 200 || response.status >= 300) {
        const message = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw Object.assign(new Error(message), { status: response.status })
    }
    const refs = response.data?.externalRefs
    return Array.isArray(refs) ? refs as ExternalRef[] : []
}

async function putExternalRefs(sessionId: string, externalRefs: ExternalRef[]) {
    const response = await axios.put(
        `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/external-refs`,
        { externalRefs },
        {
            headers: authHeaders(),
            timeout: 30_000,
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

        const ref = buildGithubPrExternalRef({
            repo: parsed.repo,
            number: parsed.number,
            role: 'primary',
            source: 'agent',
            linkedAt: Date.now()
        })

        try {
            const current = await getExternalRefs(sessionId)
            const retained = current.filter(
                (candidate) => candidate.kind !== 'github_pr' || candidate.role !== 'primary'
            )
            const response = await putExternalRefs(sessionId, [...retained, ref])
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
            console.log(chalk.green(`Linked ${parsed.repo}#${parsed.number} to session ${sessionId}`))
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'request failed')
            process.exit(1)
        }
    }
}
