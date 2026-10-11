import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import { AddTodoBoardRequestSchema, type TodoBoardItem, type TodoBoardItemsResponse, type TodoBoardsResponse } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { getSettingsFile, readSettingsOrThrow, updateSettings, type StoredTodoBoard } from '../../config/settings'

/**
 * First shippable slice of the to-do/board view (hapi#235): GitHub Projects
 * v2 boards, read via the host's already-authenticated `gh` CLI. No
 * multi-identity auth, caching, or pagination beyond a single page of items
 * — that's the full data-layer issue (#234).
 *
 * Boards are config (env default + user-added, persisted in settings.json),
 * never a hardcoded constant — a real personal board was hardcoded here
 * earlier and caught before it shipped (see hapi#235 discussion). The env
 * default must stay a dull, public, nothing-real demo board
 * (`heavygee/hapi-demo-board`, project 6) so a forgotten env var never
 * surfaces anyone's real data, and the stored list must never go empty
 * (removal re-seeds the default instead) — both are load-bearing safety
 * invariants, not incidental defaults. See `withTodoBoardsInvariant` below —
 * every settings.json writer for `todoBoards` must go through it, not
 * reimplement the empty-list fallback inline.
 *
 * Known landmine for the next person touching this file: every board added
 * via POST /todo-boards (and the env-configured default) hardcodes
 * `statusFieldName: 'Status'` — a board whose status field is actually named
 * something else ("Stage", "Workflow Status") will silently come back with
 * an empty `statusOrder` and every item dumped in the "no status" bucket, no
 * error surfaced anywhere. Per-board status-field customization is explicit
 * out-of-scope for this slice (#234), but it's worth knowing before
 * debugging a "board looks broken" report.
 */
const DEFAULT_TODO_BOARD: StoredTodoBoard = {
    id: 'github.com::heavygee::6',
    label: 'heavygee/6',
    host: 'github.com',
    ownerLogin: 'heavygee',
    projectNumber: 6,
    statusFieldName: 'Status',
    doneValues: ['Done']
}

// Percent-encode each component before joining: host/ownerLogin come from a
// loosely-validated URL regex (parseProjectUrl), so without encoding, a
// malformed/copy-pasted URL containing a literal "::" could make two
// genuinely different boards collide on the same id (e.g. host
// "github.com::evil" + owner "foo" vs. host "github.com" + owner
// "evil::foo" both naively join to "github.com::evil::foo::1").
//
// `viewNumber` only appends when present, keeping the plain-project id
// format (`host::owner::number`) byte-for-byte stable for every
// already-stored board — the view-scoped id (`host::owner::number::view::n`)
// is a distinct, longer id so the same project and a filtered view onto it
// can both be stored as separate boards without colliding.
export function makeBoardId(host: string, ownerLogin: string, projectNumber: number, viewNumber?: number): string {
    const parts = [host, ownerLogin, String(projectNumber)]
    if (viewNumber !== undefined) {
        parts.push('view', String(viewNumber))
    }
    return parts.map(encodeURIComponent).join('::')
}

// GraphQL's Int is a non-fractional signed 32-bit value — a project number
// outside that range always 404s against `$number: Int!`, so reject it here
// instead of advertising a board that can never load.
const MAX_GRAPHQL_INT = 2_147_483_647
function isValidProjectNumber(value: number): boolean {
    return Number.isInteger(value) && value > 0 && value <= MAX_GRAPHQL_INT
}

function readEnvTodoBoardConfig(): StoredTodoBoard {
    const host = process.env.HAPI_TODO_BOARD_HOST?.trim() || DEFAULT_TODO_BOARD.host
    const ownerLogin = process.env.HAPI_TODO_BOARD_OWNER?.trim() || DEFAULT_TODO_BOARD.ownerLogin
    const numberRaw = process.env.HAPI_TODO_BOARD_NUMBER?.trim()
    const parsedNumber = numberRaw ? Number(numberRaw) : NaN
    const projectNumber = isValidProjectNumber(parsedNumber) ? parsedNumber : DEFAULT_TODO_BOARD.projectNumber
    const statusFieldName = process.env.HAPI_TODO_BOARD_STATUS_FIELD?.trim() || DEFAULT_TODO_BOARD.statusFieldName
    const doneValuesRaw = process.env.HAPI_TODO_BOARD_DONE_VALUES?.trim()
    const doneValues = doneValuesRaw
        ? doneValuesRaw.split(',').map(value => value.trim()).filter(Boolean)
        : DEFAULT_TODO_BOARD.doneValues
    const label = process.env.HAPI_TODO_BOARD_LABEL?.trim() || `${ownerLogin}/${projectNumber}`

    return {
        id: makeBoardId(host, ownerLogin, projectNumber),
        label,
        host,
        ownerLogin,
        projectNumber,
        statusFieldName,
        doneValues
    }
}

/**
 * Stored list is the source of truth once non-empty; otherwise fall back to
 * the env-configured (or hardcoded-safe) default — never persisted until the
 * operator explicitly adds a board.
 *
 * Deliberate consequence, not a bug: env vars are a one-time *seed*, not an
 * ongoing config source. The moment any board is added (the entire point of
 * this feature), the then-current env-derived default is snapshotted into
 * settings.json as a plain stored board — further changes to
 * HAPI_TODO_BOARD_* env vars afterward have zero effect on it (or on any
 * newly-added board, which always gets the hardcoded 'Status'/['Done']
 * defaults, not live env values either). The only way back to env-driven
 * behavior is deleting every stored board down to zero. This matches the
 * explicit design intent ("the env-var default becomes the zero-config
 * seed/fallback, not the only board") but is worth stating plainly here
 * since it's easy to assume env vars stay authoritative after a restart —
 * they don't, once settings.json has any todoBoards entry.
 */
async function loadTodoBoards(dataDir: string): Promise<StoredTodoBoard[]> {
    const settings = await readSettingsOrThrow(getSettingsFile(dataDir))
    if (settings.todoBoards && settings.todoBoards.length > 0) {
        return settings.todoBoards
    }
    return [readEnvTodoBoardConfig()]
}

/**
 * Single choke point for every settings.json write to `todoBoards` — the
 * "never empty" safety invariant (see module doc comment) lives here once,
 * not reimplemented per-handler. `mutate` receives the current list
 * (already non-empty, falling back to the env default) and returns the next
 * list; if `mutate` returns the same array reference back (no-op, e.g.
 * deleting an id that was never there), the write is skipped entirely —
 * mirrors POST's existing idempotent-add behavior, and avoids a no-op
 * DELETE silently pinning the env-derived default into settings.json as a
 * side effect of writing back a list that didn't actually change.
 */
async function updateTodoBoards(
    dataDir: string,
    mutate: (current: StoredTodoBoard[]) => StoredTodoBoard[]
): Promise<StoredTodoBoard[]> {
    return updateSettings(getSettingsFile(dataDir), (current) => {
        const existing = current.todoBoards && current.todoBoards.length > 0 ? current.todoBoards : [readEnvTodoBoardConfig()]
        const next = mutate(existing)
        if (next === existing) {
            return { settings: current, result: existing, write: false }
        }
        const finalBoards = next.length > 0 ? next : [readEnvTodoBoardConfig()]
        return { settings: { ...current, todoBoards: finalBoards }, result: finalBoards }
    })
}

const GH_TIMEOUT_MS = 15_000

const ITEM_FIELDS = `
  id
  content {
    __typename
    ... on Issue { title number url state updatedAt body repository { nameWithOwner } }
    ... on PullRequest { title number url state updatedAt body repository { nameWithOwner } }
    ... on DraftIssue { title updatedAt body }
  }
  fieldValueByName(name: $statusField) {
    ... on ProjectV2ItemFieldSingleSelectValue { name }
  }`

const PROJECT_QUERY = `
query($login: String!, $number: Int!, $statusField: String!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        field(name: $statusField) {
          ... on ProjectV2SingleSelectField {
            options { name }
          }
        }
        items(first: 100) {
          nodes { ${ITEM_FIELDS} }
        }
      }
    }
  }
}`

// Same as PROJECT_QUERY plus `items(query: $itemsFilter)` — GitHub's own
// Projects filter-bar syntax, the same string a ProjectV2View's `filter`
// field stores. Named `$itemsFilter`, not `$query`: `gh api graphql` reads
// `-f query=<document>` to mean the GraphQL document itself, so a second
// `-f query=<value>` for a same-named GraphQL *variable* collides at the gh
// CLI layer ("unexpected override existing field under \"query\""), not the
// GraphQL server — confirmed by hand against a live view before landing this.
//
// A separate query from PROJECT_QUERY (not PROJECT_QUERY with an
// always-nullable filter variable) on purpose: the `query` argument on
// `items` is a newer addition (per `gh project item-list --help`,
// "supported by github.com and GHES 3.20+") — embedding it unconditionally
// would risk breaking the existing, much more common no-view board read on
// an older GHES host that doesn't recognize the argument at all, even when
// the variable is passed as null. Only used when a view is actually
// configured, so the new argument's host requirement is scoped to the new
// capability, not the existing one.
const PROJECT_QUERY_FILTERED = `
query($login: String!, $number: Int!, $statusField: String!, $itemsFilter: String) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        field(name: $statusField) {
          ... on ProjectV2SingleSelectField {
            options { name }
          }
        }
        items(first: 100, query: $itemsFilter) {
          nodes { ${ITEM_FIELDS} }
        }
      }
    }
  }
}`

// Deliberately lighter than PROJECT_QUERY: adding a board only needs to
// confirm it resolves and get a display label, not pull every item (and
// every item's full markdown body) just to throw the response away.
const PROJECT_TITLE_QUERY = `
query($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
      }
    }
  }
}`

// Resolves a saved view's name + filter string. Used two ways: validating +
// labeling a board-add for a `/views/<n>` URL, and (via `runGhGraphql`)
// turning a view-scoped board's stored viewNumber into the `query` argument
// for PROJECT_QUERY's `items` field before every items fetch — the view's
// filter isn't cached, so editing it in GitHub's UI takes effect immediately
// here too, same as reloading the view on github.com would.
const PROJECT_VIEW_QUERY = `
query($login: String!, $number: Int!, $viewNumber: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        view(number: $viewNumber) {
          name
          filter
        }
      }
    }
  }
}`

type GhProjectV2Response = {
    data?: {
        repositoryOwner?: {
            projectV2?: {
                title?: string
                field?: { options?: Array<{ name: string }> } | null
                items?: {
                    // GitHub's ProjectV2ItemConnection declares `nodes` as
                    // `[ProjectV2Item]!` (nullable elements, non-null list).
                    nodes?: Array<{
                        id: string
                        content: {
                            __typename: string
                            title?: string
                            number?: number
                            url?: string
                            state?: 'OPEN' | 'CLOSED'
                            updatedAt?: string
                            body?: string
                            repository?: { nameWithOwner: string }
                        } | null
                        fieldValueByName?: { name: string } | null
                    } | null>
                } | null
            } | null
        } | null
    }
    errors?: Array<{ message: string }>
}

type GhProjectTitleResponse = {
    data?: {
        repositoryOwner?: {
            projectV2?: { title?: string } | null
        } | null
    }
    errors?: Array<{ message: string }>
}

type GhProjectViewResponse = {
    data?: {
        repositoryOwner?: {
            projectV2?: {
                title?: string
                view?: { name?: string; filter?: string | null } | null
            } | null
        } | null
    }
    errors?: Array<{ message: string }>
}

const execFileAsync = promisify(execFile)

type ProjectQueryTarget = {
    host: string
    ownerLogin: string
    projectNumber: number
    statusFieldName: string
    viewNumber?: number
}

type ProjectLookupTarget = {
    host: string
    ownerLogin: string
    projectNumber: number
}

type ProjectViewLookupTarget = {
    host: string
    ownerLogin: string
    projectNumber: number
    viewNumber: number
}

// Async (not spawnSync): this runs on the shared hub event loop, and a slow
// or rate-limited GitHub response must not stall every other request in
// flight (SSE streams, unrelated API calls) for the duration of the call.
async function execGhGraphql(host: string, query: string, variables: Record<string, string | number | undefined>): Promise<string> {
    const args = ['api', '--hostname', host, 'graphql', '-f', `query=${query}`]
    for (const [key, value] of Object.entries(variables)) {
        // Omit entirely rather than sending an empty string — `$itemsFilter:
        // String` is nullable, and a missing variable resolves to null (no
        // filter), not an empty-string filter GitHub might interpret differently.
        if (value === undefined) continue
        args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
    }
    try {
        const result = await execFileAsync('gh', args, { encoding: 'utf-8', timeout: GH_TIMEOUT_MS })
        return result.stdout
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            throw new Error('gh CLI not available: spawn gh ENOENT')
        }
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
        throw new Error(`gh api graphql failed: ${stderr || (error instanceof Error ? error.message : String(error))}`)
    }
}

async function runGhGraphqlView(target: ProjectViewLookupTarget): Promise<GhProjectViewResponse> {
    const stdout = await execGhGraphql(target.host, PROJECT_VIEW_QUERY, {
        login: target.ownerLogin,
        number: target.projectNumber,
        viewNumber: target.viewNumber
    })
    try {
        return JSON.parse(stdout) as GhProjectViewResponse
    } catch {
        throw new Error('gh api graphql returned non-JSON output')
    }
}

async function runGhGraphql(target: ProjectQueryTarget): Promise<GhProjectV2Response> {
    if (target.viewNumber === undefined) {
        const stdout = await execGhGraphql(target.host, PROJECT_QUERY, {
            login: target.ownerLogin,
            number: target.projectNumber,
            statusField: target.statusFieldName
        })
        try {
            return JSON.parse(stdout) as GhProjectV2Response
        } catch {
            throw new Error('gh api graphql returned non-JSON output')
        }
    }

    const viewResponse = await runGhGraphqlView({
        host: target.host,
        ownerLogin: target.ownerLogin,
        projectNumber: target.projectNumber,
        viewNumber: target.viewNumber
    })
    const resolved = resolveProjectView(viewResponse, target.viewNumber)
    if (!resolved.ok) {
        throw new Error(resolved.error)
    }

    const stdout = await execGhGraphql(target.host, PROJECT_QUERY_FILTERED, {
        login: target.ownerLogin,
        number: target.projectNumber,
        statusField: target.statusFieldName,
        itemsFilter: resolved.itemsFilter
    })
    try {
        return JSON.parse(stdout) as GhProjectV2Response
    } catch {
        throw new Error('gh api graphql returned non-JSON output')
    }
}

export type ResolveProjectViewResult =
    | { ok: true; title: string | undefined; viewName: string | undefined; itemsFilter: string | undefined }
    | { ok: false; error: string }

/**
 * Pure (no gh/execFile), so it's unit-testable without mocking a subprocess —
 * unlike the gh-invoking functions around it. Used by both POST /todo-boards
 * (needs title + view name for the label) and runGhGraphql's items path
 * (needs just the filter) so "project not found" vs "view not found" are a
 * single source of truth instead of two independently-maintained checks that
 * drifted (hapi#238 Codex-adjacent self-review: GET items used to 502 with a
 * generic thrown Error for both cases instead of 404 like POST already did).
 *
 * Treats an empty/whitespace-only `filter` the same as a missing one — the
 * underlying GraphQL field is untyped-nullable `String`, and an empty string
 * is observed in practice (e.g. after a view's filter is cleared via the API
 * rather than never having been set), not just `null`.
 */
export function resolveProjectView(viewResponse: GhProjectViewResponse, viewNumber: number): ResolveProjectViewResult {
    if (viewResponse.errors?.length) {
        return { ok: false, error: viewResponse.errors.map(e => e.message).join('; ') }
    }
    const projectV2 = viewResponse.data?.repositoryOwner?.projectV2
    if (!projectV2) {
        return { ok: false, error: 'Project not found, or not accessible with the current gh auth' }
    }
    if (!projectV2.view) {
        return { ok: false, error: `View ${viewNumber} not found on this project` }
    }
    const trimmedFilter = projectV2.view.filter?.trim()
    return {
        ok: true,
        title: projectV2.title,
        viewName: projectV2.view.name,
        itemsFilter: trimmedFilter ? trimmedFilter : undefined
    }
}

async function runGhGraphqlTitle(target: ProjectLookupTarget): Promise<GhProjectTitleResponse> {
    const stdout = await execGhGraphql(target.host, PROJECT_TITLE_QUERY, {
        login: target.ownerLogin,
        number: target.projectNumber
    })
    try {
        return JSON.parse(stdout) as GhProjectTitleResponse
    } catch {
        throw new Error('gh api graphql returned non-JSON output')
    }
}

function mapItems(response: GhProjectV2Response): TodoBoardItem[] {
    const nodes = response.data?.repositoryOwner?.projectV2?.items?.nodes ?? []
    const items: TodoBoardItem[] = []
    for (const node of nodes) {
        if (!node?.content) {
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
            updatedAt: node.content.updatedAt ?? null,
            body: node.content.body ?? null
        })
    }
    return items
}

/**
 * Accepts the handful of GitHub Projects v2 URL shapes `gh` itself surfaces:
 * `https://github.com/users/<handle>/projects/<n>`,
 * `https://github.com/orgs/<org>/projects/<n>`, and the GHE equivalent on
 * any other host. `gh project` takes `--owner` uniformly for both users and
 * orgs, so the user/org distinction in the URL only matters for parsing, not
 * for the resulting `gh api` call.
 *
 * Also accepts a trailing `/views/<n>` — a saved, filtered view of the same
 * project (same items, a server-stored `filter` query string applied).
 * Adding a view URL creates a *separate* board id from the plain project URL
 * (`makeBoardId`'s optional `viewNumber`), so both can be added side by side:
 * the unfiltered project and one or more restricted views onto it.
 */
export function parseProjectUrl(url: string): { host: string; ownerLogin: string; projectNumber: number; viewNumber?: number } | null {
    // The trailing catch-all must not swallow a malformed `/views/<non-digit>`
    // segment as generic trailing junk — without the negative lookahead,
    // `.../projects/6/views/not-a-number` would silently parse as if the
    // `/views/...` suffix was never there instead of being rejected. The
    // lookahead requires a path-segment boundary right after "views" (`/`,
    // `?`, `#`, or end-of-string) so it only excludes genuine `/views[/...]`
    // segments — not an unrelated trailing path that merely starts with the
    // same letters, like `.../projects/6/viewsomething`.
    const match = /^(?:https?:\/\/)?([^/]+)\/(?:users|orgs)\/([^/]+)\/projects\/(\d+)(?:\/views\/(\d+))?\/?(?:(?!\/views(?:[/?#]|$))[/?#].*)?$/i.exec(url.trim())
    if (!match) {
        return null
    }
    const [, host, ownerLogin, numberRaw, viewNumberRaw] = match
    const projectNumber = Number(numberRaw)
    if (!isValidProjectNumber(projectNumber)) {
        return null
    }
    if (viewNumberRaw === undefined) {
        return { host: host!, ownerLogin: ownerLogin!, projectNumber }
    }
    const viewNumber = Number(viewNumberRaw)
    if (!isValidProjectNumber(viewNumber)) {
        return null
    }
    return { host: host!, ownerLogin: ownerLogin!, projectNumber, viewNumber }
}

function toSummary(board: StoredTodoBoard): { id: string; label: string } {
    return { id: board.id, label: board.label }
}

export function createTodoBoardRoutes(
    dataDir: string,
    runGraphql: (target: ProjectQueryTarget) => GhProjectV2Response | Promise<GhProjectV2Response> = runGhGraphql,
    runGraphqlTitle: (target: ProjectLookupTarget) => GhProjectTitleResponse | Promise<GhProjectTitleResponse> = runGhGraphqlTitle,
    runGraphqlView: (target: ProjectViewLookupTarget) => GhProjectViewResponse | Promise<GhProjectViewResponse> = runGhGraphqlView
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/todo-boards', async (c) => {
        const boards = await loadTodoBoards(dataDir)
        const body: TodoBoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.post('/todo-boards', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = AddTodoBoardRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string }' }, 400)
        }
        const target = parseProjectUrl(parsed.data.url)
        if (!target) {
            return c.json({ error: 'Could not parse a GitHub Projects URL (expected e.g. https://github.com/users/<handle>/projects/<n> or .../orgs/<org>/projects/<n>)' }, 400)
        }

        let label: string
        if (target.viewNumber !== undefined) {
            let viewResponse: GhProjectViewResponse
            try {
                viewResponse = await runGraphqlView({ host: target.host, ownerLogin: target.ownerLogin, projectNumber: target.projectNumber, viewNumber: target.viewNumber })
            } catch (error) {
                return c.json({ error: error instanceof Error ? error.message : 'Failed to reach the board' }, 502)
            }
            const resolved = resolveProjectView(viewResponse, target.viewNumber)
            if (!resolved.ok) {
                // Both "project not found" and "view not found" are 404 —
                // the GraphQL-errors case (malformed field name etc.) stays
                // 502, matching the non-view branch below.
                const status = resolved.error.includes('not found') ? 404 : 502
                return c.json({ error: resolved.error }, status)
            }
            const projectLabel = resolved.title || `${target.ownerLogin}/${target.projectNumber}`
            label = resolved.viewName ? `${projectLabel} · ${resolved.viewName}` : `${projectLabel} · View ${target.viewNumber}`
        } else {
            let ghResponse: GhProjectTitleResponse
            try {
                ghResponse = await runGraphqlTitle(target)
            } catch (error) {
                return c.json({ error: error instanceof Error ? error.message : 'Failed to reach the board' }, 502)
            }
            if (ghResponse.errors?.length) {
                return c.json({ error: ghResponse.errors.map(e => e.message).join('; ') }, 502)
            }
            const projectV2 = ghResponse.data?.repositoryOwner?.projectV2
            if (!projectV2) {
                return c.json({ error: 'Project not found, or not accessible with the current gh auth' }, 404)
            }
            label = projectV2.title || `${target.ownerLogin}/${target.projectNumber}`
        }

        const newBoard: StoredTodoBoard = {
            id: makeBoardId(target.host, target.ownerLogin, target.projectNumber, target.viewNumber),
            label,
            host: target.host,
            ownerLogin: target.ownerLogin,
            projectNumber: target.projectNumber,
            statusFieldName: DEFAULT_TODO_BOARD.statusFieldName,
            doneValues: DEFAULT_TODO_BOARD.doneValues,
            ...(target.viewNumber !== undefined ? { viewNumber: target.viewNumber } : {})
        }

        // "Add" always means add — the env/default board stays in the list
        // on the very first add rather than being silently dropped. Returning
        // the same `existing` reference back when the id already exists is
        // what makes this idempotent (see updateTodoBoards' no-op write skip).
        const boards = await updateTodoBoards(dataDir, (existing) =>
            existing.some(b => b.id === newBoard.id) ? existing : [...existing, newBoard]
        )

        const body: TodoBoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.delete('/todo-boards/:id', async (c) => {
        const id = c.req.param('id')
        // Safety invariant, non-negotiable: never leave the list empty —
        // enforced inside updateTodoBoards itself, not here. Returning
        // `existing` unchanged for an id that was never there keeps this a
        // true no-op (skips the write) rather than silently pinning the
        // env-derived default into settings.json for nothing.
        const boards = await updateTodoBoards(dataDir, (existing) => {
            const filtered = existing.filter(b => b.id !== id)
            return filtered.length === existing.length ? existing : filtered
        })

        const body: TodoBoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.get('/todo-boards/:id/items', async (c) => {
        const boards = await loadTodoBoards(dataDir)
        const board = boards.find(b => b.id === c.req.param('id'))
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
                board: toSummary(board),
                statusOrder,
                doneValues: board.doneValues,
                items: mapItems(ghResponse)
            }
            return c.json(body)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read board'
            // Matches resolveProjectView's two "not found" messages — a
            // view-scoped board whose view or underlying project vanished
            // (deleted/renamed/access revoked) after being added should 404
            // the same way the plain-project equivalent already does above,
            // not fall through to a generic 502.
            if (message.includes('not found')) {
                return c.json({ error: message }, 404)
            }
            return c.json({ error: message }, 502)
        }
    })

    return app
}
