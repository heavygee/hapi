import chalk from 'chalk'
import { initializeToken } from '@/ui/tokenInit'
import {
    SearchContentError,
    exitCodeForSearchContentError,
    formatSearchContentMatches,
    searchSessionContent
} from '@/modules/searchContent/searchContent'
import type { CommandDefinition } from './types'

type ParsedSearchContentArgs = {
    help: boolean
    query?: string
    limit?: number
    sessionId?: string
}

function showHelp(): void {
    console.log(`
${chalk.bold('hapi search-content')} - Search session transcript text across the fleet

${chalk.bold('Usage:')}
  hapi search-content <query>
  hapi search-content <query> --limit 50
  hapi search-content <query> --session-id <uuid>

${chalk.bold('Notes:')}
  Uses CLI_API_TOKEN → JWT (same as search-peers / ping-peer). Never hand-mint a JWT —
  an expired token used to return an empty list, indistinguishable from no matches.
  Prefer MCP search_content inside a session.
  Short/common substrings match badly (trigram FTS): prefer distinctive nouns.

${chalk.bold('Env:')}
  HAPI_API_URL / CLI_API_TOKEN (or ~/.hapi/settings.json via \`hapi auth login\`)
`)
}

export function parseSearchContentArgs(args: string[]): ParsedSearchContentArgs {
    const result: ParsedSearchContentArgs = { help: false }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!
        if (arg === '--help' || arg === '-h') {
            result.help = true
            continue
        }
        if (arg === '--limit') {
            const value = args[++i]
            if (!value) {
                throw new SearchContentError('bad_args', '--limit requires a number')
            }
            result.limit = Number(value)
            continue
        }
        if (arg.startsWith('--limit=')) {
            result.limit = Number(arg.slice('--limit='.length))
            continue
        }
        if (arg === '--session-id') {
            const value = args[++i]
            if (!value) {
                throw new SearchContentError('bad_args', '--session-id requires a uuid')
            }
            result.sessionId = value
            continue
        }
        if (arg.startsWith('--session-id=')) {
            result.sessionId = arg.slice('--session-id='.length)
            continue
        }
        if (arg.startsWith('-')) {
            throw new SearchContentError('bad_args', `unexpected flag: ${arg}`)
        }
        if (result.query === undefined) {
            result.query = arg
            continue
        }
        result.query = `${result.query} ${arg}`
    }

    if (result.limit !== undefined && (!Number.isFinite(result.limit) || result.limit < 1)) {
        throw new SearchContentError('bad_args', '--limit must be a positive number')
    }

    return result
}

export async function handleSearchContentCommand(args: string[]): Promise<void> {
    const parsed = parseSearchContentArgs(args)
    if (parsed.help) {
        showHelp()
        return
    }

    await initializeToken()

    const query = parsed.query?.trim() ?? ''
    if (!query) {
        showHelp()
        throw new SearchContentError('bad_args', 'missing query; usage: hapi search-content <query>')
    }

    const limit = parsed.limit ?? 50
    const result = await searchSessionContent({
        query,
        limit,
        sessionId: parsed.sessionId
    })
    console.log(formatSearchContentMatches(result, { query, maxRows: limit }))
}

export const searchContentCommand: CommandDefinition = {
    name: 'search-content',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await handleSearchContentCommand(commandArgs)
        } catch (error) {
            if (error instanceof SearchContentError) {
                console.error(chalk.red('hapi search-content:'), error.message)
                process.exit(exitCodeForSearchContentError(error))
            }
            console.error(
                chalk.red('hapi search-content:'),
                error instanceof Error ? error.message : 'Unknown error'
            )
            process.exit(1)
        }
    }
}
