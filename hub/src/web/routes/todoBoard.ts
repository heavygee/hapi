import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import type { TodoBoardItem, TodoBoardItemsResponse, TodoBoardsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'

/**
 * First shippable slice of the to-do/board view (hapi#235): one GitHub
 * Projects v2 board, read via the host's already-authenticated `gh` CLI. No
 * multi-host/multi-identity auth, caching, or pagination beyond a single
 * page of items — that's the full data-layer issue (#234).
 *
 * The board is config (env, with a safe default), not a constant — a real
 * personal board was hardcoded here earlier and caught before it shipped
 * (see hapi#235 discussion). The default must stay a dull, public,
 * nothing-real demo board (`heavygee/hapi-demo-board`, project 6) so a
 * forgotten env var never surfaces anyone's real data.
 */
type TodoBoardConfig = {
    id: string
    label: string
    ownerLogin: string
    projectNumber: number
    statusFieldName: string
    doneValues: string[]
}

const DEFAULT_TODO_BOARD: TodoBoardConfig = {
    id: 'heavygee-6',
    label: 'heavygee/6',
    ownerLogin: 'heavygee',
    projectNumber: 6,
    statusFieldName: 'Status',
    doneValues: ['Done']
}

function readTodoBoardConfig(): TodoBoardConfig {
    const ownerLogin = process.env.HAPI_TODO_BOARD_OWNER?.trim() || DEFAULT_TODO_BOARD.ownerLogin
    const numberRaw = process.env.HAPI_TODO_BOARD_NUMBER?.trim()
    const parsedNumber = numberRaw ? Number(numberRaw) : NaN
    const projectNumber = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : DEFAULT_TODO_BOARD.projectNumber
    const statusFieldName = process.env.HAPI_TODO_BOARD_STATUS_FIELD?.trim() || DEFAULT_TODO_BOARD.statusFieldName
    const doneValuesRaw = process.env.HAPI_TODO_BOARD_DONE_VALUES?.trim()
    const doneValues = doneValuesRaw
        ? doneValuesRaw.split(',').map(value => value.trim()).filter(Boolean)
        : DEFAULT_TODO_BOARD.doneValues
    const label = process.env.HAPI_TODO_BOARD_LABEL?.trim() || `${ownerLogin}/${projectNumber}`

    return {
        id: `${ownerLogin}-${projectNumber}`,
        label,
        ownerLogin,
        projectNumber,
        statusFieldName,
        doneValues
    }
}

const GH_TIMEOUT_MS = 15_000

const PROJECT_ITEMS_QUERY = `
query($login: String!, $number: Int!, $statusField: String!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        field(name: $statusField) {
          ... on ProjectV2SingleSelectField {
            options { name }
          }
        }
        items(first: 100) {
          nodes {
            id
            content {
              __typename
              ... on Issue { title number url state updatedAt repository { nameWithOwner } }
              ... on PullRequest { title number url state updatedAt repository { nameWithOwner } }
              ... on DraftIssue { title updatedAt }
            }
            fieldValueByName(name: $statusField) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
}`

type GhProjectV2Response = {
    data?: {
        repositoryOwner?: {
            projectV2?: {
                field?: { options?: Array<{ name: string }> } | null
                items?: {
                    nodes?: Array<{
                        id: string
                        content: {
                            __typename: string
                            title?: string
                            number?: number
                            url?: string
                            state?: 'OPEN' | 'CLOSED'
                            updatedAt?: string
                            repository?: { nameWithOwner: string }
                        } | null
                        fieldValueByName?: { name: string } | null
                    }>
                } | null
            } | null
        } | null
    }
    errors?: Array<{ message: string }>
}

const execFileAsync = promisify(execFile)

// Async (not spawnSync): this runs on the shared hub event loop, and a slow
// or rate-limited GitHub response must not stall every other request in
// flight (SSE streams, unrelated API calls) for the duration of the call.
async function runGhGraphql(board: TodoBoardConfig): Promise<GhProjectV2Response> {
    let stdout: string
    try {
        const result = await execFileAsync('gh', [
            'api', 'graphql',
            '-f', `query=${PROJECT_ITEMS_QUERY}`,
            '-f', `login=${board.ownerLogin}`,
            '-F', `number=${board.projectNumber}`,
            '-f', `statusField=${board.statusFieldName}`
        ], {
            encoding: 'utf-8',
            timeout: GH_TIMEOUT_MS
        })
        stdout = result.stdout
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            throw new Error('gh CLI not available: spawn gh ENOENT')
        }
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
        throw new Error(`gh api graphql failed: ${stderr || (error instanceof Error ? error.message : String(error))}`)
    }

    try {
        return JSON.parse(stdout) as GhProjectV2Response
    } catch {
        throw new Error('gh api graphql returned non-JSON output')
    }
}

function mapItems(response: GhProjectV2Response): TodoBoardItem[] {
    const nodes = response.data?.repositoryOwner?.projectV2?.items?.nodes ?? []
    const items: TodoBoardItem[] = []
    for (const node of nodes) {
        if (!node.content) {
            continue
        }
        items.push({
            id: node.id,
            title: node.content.title ?? '(untitled)',
            url: node.content.url ?? null,
            number: node.content.number ?? null,
            repo: node.content.repository?.nameWithOwner ?? null,
            state: node.content.state ?? null,
            status: node.fieldValueByName?.name ?? null,
            updatedAt: node.content.updatedAt ?? null
        })
    }
    return items
}

export function createTodoBoardRoutes(
    runGraphql: (board: TodoBoardConfig) => GhProjectV2Response | Promise<GhProjectV2Response> = runGhGraphql
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    // Read once per route-set creation (hub startup), not per request — env
    // doesn't change mid-process, and this keeps request handlers simple.
    const todoBoards: TodoBoardConfig[] = [readTodoBoardConfig()]

    app.get('/todo-boards', (c) => {
        const body: TodoBoardsResponse = {
            boards: todoBoards.map(board => ({ id: board.id, label: board.label }))
        }
        return c.json(body)
    })

    app.get('/todo-boards/:id/items', async (c) => {
        const board = todoBoards.find(b => b.id === c.req.param('id'))
        if (!board) {
            return c.json({ error: 'Unknown board' }, 404)
        }

        try {
            const ghResponse = await runGraphql(board)
            if (ghResponse.errors?.length) {
                return c.json({ error: ghResponse.errors.map(e => e.message).join('; ') }, 502)
            }

            const statusOrder = ghResponse.data?.repositoryOwner?.projectV2?.field?.options?.map(o => o.name) ?? []
            const body: TodoBoardItemsResponse = {
                board: { id: board.id, label: board.label },
                statusOrder,
                doneValues: board.doneValues,
                items: mapItems(ghResponse)
            }
            return c.json(body)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to read board' }, 502)
        }
    })

    return app
}
