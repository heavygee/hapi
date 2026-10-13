import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import {
    AddBoardRequestSchema,
    BoardItemCloseRequestSchema,
    BoardItemCommentRequestSchema,
    BoardItemReopenRequestSchema,
    BoardItemStatusRequestSchema,
    type BoardItem,
    type BoardItemsResponse,
    type BoardsResponse
} from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import { getSettingsFile, readSettingsOrThrow, updateSettings, type StoredTodoBoard } from '../../config/settings'

/**
 * First shippable slice of the board view (hapi#235): GitHub Projects
 * v2 boards, read via the host's already-authenticated `gh` CLI. No
 * multi-identity auth, caching, or pagination beyond a single page of items
 * — that's the full data-layer issue (#234).
 *
 * Boards are config (env default + user-added, persisted in settings.json),
 * never a hardcoded constant — a real personal board was hardcoded here
 * earlier and caught before it shipped (see hapi#235 discussion). The env
 * default must stay a dull, public, nothing-real demo board
 * (`heavygee/hapi-demo-board`, project 6) so a forgotten env var never
 * surfaces anyone's real data — that invariant still holds, but a genuinely
 * empty board list is no longer prevented (operator decision, hapi#238):
 * it used to be impossible to tell "nothing configured" from "the hardcoded
 * demo," so a fresh install with no `gh` auth at all would silently load the
 * demo board and then 502 on its items fetch with a raw `gh api graphql
 * failed` error. GET /todo-boards now genuinely returns `[]` when nothing is
 * configured, and the frontend shows a static explainer instead of ever
 * attempting that fetch. See `loadBoards`/`updateBoards` below — every
 * settings.json reader/writer for `todoBoards` must go through them, not
 * reimplement the env-seed-or-empty fallback inline.
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
const DEFAULT_BOARD: StoredTodoBoard = {
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
// Lowercased before joining — GitHub hostnames and owner logins are
// case-insensitive, so adding the same project twice with different casing
// (e.g. `orgs/Acme/projects/1` after `orgs/acme/projects/1`) must resolve to
// the same id for the idempotent-add check below to actually work, instead
// of silently persisting a second board that issues identical GraphQL
// requests (Codex review). `StoredTodoBoard.host`/`ownerLogin` themselves
// keep whatever casing the caller used — only the opaque id is normalized,
// never shown to the operator.
//
// `viewNumber` only appends when present, keeping the plain-project id
// format (`host::owner::number`) byte-for-byte stable for every
// already-stored board — the view-scoped id (`host::owner::number::view::n`)
// is a distinct, longer id so the same project and a filtered view onto it
// can both be stored as separate boards without colliding.
export function makeBoardId(host: string, ownerLogin: string, projectNumber: number, viewNumber?: number): string {
    const parts = [host.toLowerCase(), ownerLogin.toLowerCase(), String(projectNumber)]
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

// Whether the operator has actually set any HAPI_BOARD_* env var — distinct
// from readEnvBoardConfig() always being able to *produce* a board, since
// every one of its fields individually falls back to DEFAULT_BOARD's demo
// values. Without this check there's no way to tell "operator configured a
// real board via env vars" from "nothing is configured at all, here's the
// hardcoded demo" — both looked identical to loadBoards()'s caller (operator
// decision, hapi#238: a genuinely-empty board list is now a real, displayed
// state — a static explainer, not a silently-loaded demo board that 502s
// with a raw `gh api graphql failed` wall of text on a machine with no `gh`
// auth at all).
function hasAnyBoardEnvConfig(): boolean {
    return Boolean(
        process.env.HAPI_BOARD_HOST?.trim() ||
        process.env.HAPI_BOARD_OWNER?.trim() ||
        process.env.HAPI_BOARD_NUMBER?.trim() ||
        process.env.HAPI_BOARD_STATUS_FIELD?.trim() ||
        process.env.HAPI_BOARD_DONE_VALUES?.trim() ||
        process.env.HAPI_BOARD_LABEL?.trim()
    )
}

function readEnvBoardConfig(): StoredTodoBoard {
    const host = process.env.HAPI_BOARD_HOST?.trim() || DEFAULT_BOARD.host
    const ownerLogin = process.env.HAPI_BOARD_OWNER?.trim() || DEFAULT_BOARD.ownerLogin
    const numberRaw = process.env.HAPI_BOARD_NUMBER?.trim()
    const parsedNumber = numberRaw ? Number(numberRaw) : NaN
    const projectNumber = isValidProjectNumber(parsedNumber) ? parsedNumber : DEFAULT_BOARD.projectNumber
    const statusFieldName = process.env.HAPI_BOARD_STATUS_FIELD?.trim() || DEFAULT_BOARD.statusFieldName
    const doneValuesRaw = process.env.HAPI_BOARD_DONE_VALUES?.trim()
    const doneValues = doneValuesRaw
        ? doneValuesRaw.split(',').map(value => value.trim()).filter(Boolean)
        : DEFAULT_BOARD.doneValues
    const label = process.env.HAPI_BOARD_LABEL?.trim() || `${ownerLogin}/${projectNumber}`

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
 * the env-configured board if any HAPI_BOARD_* var is actually set, or
 * genuinely empty otherwise — never persisted until the operator explicitly
 * adds a board. A truly empty list is a real, intentional state now
 * (operator decision, hapi#238): the frontend shows a static explainer
 * instead of ever hitting the items endpoint for a board nobody configured,
 * which used to always exist as a hardcoded demo default.
 *
 * Deliberate consequence, not a bug: env vars are a one-time *seed*, not an
 * ongoing config source. The moment any board is added (the entire point of
 * this feature), the then-current env-derived default is snapshotted into
 * settings.json as a plain stored board — further changes to
 * HAPI_BOARD_* env vars afterward have zero effect on it (or on any
 * newly-added board, which always gets the hardcoded 'Status'/['Done']
 * defaults, not live env values either). The only way back to env-driven
 * behavior is deleting every stored board down to zero. This matches the
 * explicit design intent ("the env-var default becomes the zero-config
 * seed/fallback, not the only board") but is worth stating plainly here
 * since it's easy to assume env vars stay authoritative after a restart —
 * they don't, once settings.json has any todoBoards entry.
 */
async function loadBoards(dataDir: string): Promise<StoredTodoBoard[]> {
    const settings = await readSettingsOrThrow(getSettingsFile(dataDir))
    if (settings.todoBoards && settings.todoBoards.length > 0) {
        return settings.todoBoards
    }
    return hasAnyBoardEnvConfig() ? [readEnvBoardConfig()] : []
}

/**
 * Single choke point for every settings.json write to `todoBoards`.
 * `mutate` receives the current list (stored, or the env-derived seed if any
 * HAPI_BOARD_* var is set, or genuinely empty otherwise) and returns the
 * next list; if `mutate` returns the same array reference back (no-op, e.g.
 * deleting an id that was never there), the write is skipped entirely —
 * mirrors POST's existing idempotent-add behavior. Removing the last stored
 * board now genuinely empties the list (operator decision, hapi#238) rather
 * than re-seeding the hardcoded demo default — falls back to the env seed
 * only if one is actually configured, same as loadBoards().
 */
async function updateBoards(
    dataDir: string,
    mutate: (current: StoredTodoBoard[]) => StoredTodoBoard[]
): Promise<StoredTodoBoard[]> {
    const envSeed = hasAnyBoardEnvConfig() ? [readEnvBoardConfig()] : []
    return updateSettings(getSettingsFile(dataDir), (current) => {
        const existing = current.todoBoards && current.todoBoards.length > 0 ? current.todoBoards : envSeed
        const next = mutate(existing)
        if (next === existing) {
            return { settings: current, result: existing, write: false }
        }
        const finalBoards = next.length > 0 ? next : envSeed
        return { settings: { ...current, todoBoards: finalBoards }, result: finalBoards }
    })
}

const GH_TIMEOUT_MS = 15_000

// Shared by Issue and PullRequest — everything the detail pane needs besides
// status (handled separately via fieldValueByName) and the project's other
// custom fields (handled generically via fieldValues below). DraftIssue has
// none of these — it's a title-only card with no linked Issue/PR, so it also
// has no author/assignees/labels/milestone/close-reopen-comment support.
const ISSUE_OR_PR_FIELDS = `
  title number url state updatedAt createdAt closedAt body
  repository { nameWithOwner }
  author { login avatarUrl }
  assignees(first: 10) { nodes { login avatarUrl } }
  labels(first: 20) { nodes { name color } }
  milestone { title dueOn }`

const ITEM_FIELDS = `
  id
  content {
    __typename
    ... on Issue { ${ISSUE_OR_PR_FIELDS} }
    ... on PullRequest { ${ISSUE_OR_PR_FIELDS} }
    ... on DraftIssue { title updatedAt body }
  }
  fieldValueByName(name: $statusField) {
    ... on ProjectV2ItemFieldSingleSelectValue { name }
  }
  fieldValues(first: 20) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
    }
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

type GhFieldValueNode =
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue'; name?: string; field?: { name?: string } | null }
    | { __typename: 'ProjectV2ItemFieldTextValue'; text?: string; field?: { name?: string } | null }
    | { __typename: 'ProjectV2ItemFieldNumberValue'; number?: number; field?: { name?: string } | null }
    | { __typename: 'ProjectV2ItemFieldDateValue'; date?: string; field?: { name?: string } | null }
    | { __typename: string; field?: { name?: string } | null }

type GhProjectV2Response = {
    data?: {
        repositoryOwner?: {
            projectV2?: {
                title?: string
                field?: { options?: Array<{ name: string }> } | null
                items?: {
                    // GitHub's ProjectV2ItemConnection declares `nodes` as
                    // `[ProjectV2Item]` — individual entries can be null
                    // (e.g. an item the viewer lost access to).
                    nodes?: Array<{
                        id: string
                        content: {
                            __typename: string
                            title?: string
                            number?: number
                            url?: string
                            state?: 'OPEN' | 'CLOSED' | 'MERGED'
                            updatedAt?: string
                            createdAt?: string
                            closedAt?: string | null
                            body?: string
                            repository?: { nameWithOwner: string }
                            author?: { login: string; avatarUrl: string } | null
                            assignees?: { nodes?: Array<{ login: string; avatarUrl: string } | null> }
                            labels?: { nodes?: Array<{ name: string; color: string } | null> }
                            milestone?: { title: string; dueOn: string | null } | null
                        } | null
                        fieldValueByName?: { name: string } | null
                        fieldValues?: {
                            nodes?: Array<GhFieldValueNode | null>
                        } | null
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

// `projectItems` isn't on a shared GraphQL interface — Issue and PullRequest
// each declare it independently (confirmed via introspection: neither
// `ProjectV2Owner` nor any interface both implement exposes it) — so the
// identical field selection has to be repeated across both inline fragments
// at the GraphQL level. Interpolating one JS constant into both keeps that
// duplication to a single source of truth at least. 100 (not GitHub's
// default page size) matches this file's own items(first: 100) convention;
// an issue/PR attached to more than 100 projects — implausible but not
// impossible for a heavily cross-referenced issue in a very large org —
// would still be missed with no pagination fallback.
const PROJECT_ITEMS_MEMBERSHIP_FIELDS = `projectItems(first: 100) {
        nodes { project { number owner { ... on User { login } ... on Organization { login } } } }
      }`

// A well-formed, same-host issue/pull URL isn't necessarily an item on THIS
// board's project — a GitHub Projects v2 project can span arbitrary repos on
// its host, so the only way to confirm membership is to ask GitHub directly:
// `resource(url:)` resolves the URL to its Issue/PullRequest node and lists
// every project it's attached to via `projectItems`. Matched by project
// number + owner login (not a cached node ID — boards don't store one).
const RESOURCE_PROJECT_MEMBERSHIP_QUERY = `
query($url: URI!) {
  resource(url: $url) {
    ... on Issue {
      ${PROJECT_ITEMS_MEMBERSHIP_FIELDS}
    }
    ... on PullRequest {
      ${PROJECT_ITEMS_MEMBERSHIP_FIELDS}
    }
  }
}`

type GhResourceProjectMembershipResponse = {
    data?: {
        resource?: {
            projectItems?: {
                nodes?: Array<{ project?: { number?: number; owner?: { login?: string } | null } | null } | null>
            } | null
        } | null
    }
    errors?: Array<{ message: string }>
}

type ProjectMembershipTarget = ProjectLookupTarget & { url: string }

async function runGhGraphqlProjectMembership(target: ProjectMembershipTarget): Promise<GhResourceProjectMembershipResponse> {
    const stdout = await execGhGraphql(target.host, RESOURCE_PROJECT_MEMBERSHIP_QUERY, { url: target.url })
    try {
        return JSON.parse(stdout) as GhResourceProjectMembershipResponse
    } catch {
        throw new Error('gh api graphql returned non-JSON output')
    }
}

function isMemberOfProject(response: GhResourceProjectMembershipResponse, ownerLogin: string, projectNumber: number): boolean {
    const nodes = response.data?.resource?.projectItems?.nodes ?? []
    return nodes.some(node =>
        node?.project?.number === projectNumber &&
        node.project.owner?.login?.toLowerCase() === ownerLogin.toLowerCase()
    )
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

// Shared by every `gh` invocation below — surfaces a clear message for the
// "gh isn't installed" case instead of a raw ENOENT, and otherwise prefers
// gh's own stderr (the actually-useful part of a failure) over Node's
// generic "Command failed" error text.
function normalizeGhError(error: unknown, prefix?: string): Error {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return new Error('gh CLI not available: spawn gh ENOENT')
    }
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    return new Error(prefix ? `${prefix}: ${message}` : message)
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
        // Node's execFile defaults maxBuffer to 1MB — the items query pulls
        // every item's full markdown body (up to 100 items), which can
        // exceed that on a board with long descriptions; without raising it
        // here `gh` gets SIGTERM'd mid-response and the whole board 502s.
        const result = await execFileAsync('gh', args, { encoding: 'utf-8', timeout: GH_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 })
        return result.stdout
    } catch (error) {
        throw normalizeGhError(error, 'gh api graphql failed')
    }
}

// Non-GraphQL `gh` subcommands (issue/pr close-reopen-comment, project
// item-edit) — GH_HOST routes them to the right host the same way
// `--hostname` does for `gh api`, confirmed by hand against both github.com
// and the real lhs.ghe.com host before landing this (gh project field-list
// --owner lockhouse correctly listed that GHE project's fields under
// GH_HOST=lhs.ghe.com). Set unconditionally rather than relying on `gh`
// inferring the host from a URL argument, for the same reason execGhGraphql
// always passes --hostname explicitly: no silent dependency on ambient state.
async function execGh(args: string[], host: string): Promise<string> {
    try {
        const result = await execFileAsync('gh', args, {
            encoding: 'utf-8',
            timeout: GH_TIMEOUT_MS,
            env: { ...process.env, GH_HOST: host }
        })
        return result.stdout
    } catch (error) {
        throw normalizeGhError(error)
    }
}

export type BoardItemActionTarget = { host: string; url: string; isPullRequest: boolean }
export type BoardItemStatusTarget = { host: string; ownerLogin: string; projectNumber: number; url: string; fieldName: string; status: string }

export type BoardItemActions = {
    close: (target: BoardItemActionTarget, comment?: string) => Promise<void>
    reopen: (target: BoardItemActionTarget, comment?: string) => Promise<void>
    comment: (target: BoardItemActionTarget, body: string) => Promise<void>
    setStatus: (target: BoardItemStatusTarget) => Promise<void>
}

export const defaultBoardItemActions: BoardItemActions = {
    close: async (target, comment) => {
        const args = [target.isPullRequest ? 'pr' : 'issue', 'close', target.url]
        if (comment) args.push('--comment', comment)
        await execGh(args, target.host)
    },
    reopen: async (target, comment) => {
        const args = [target.isPullRequest ? 'pr' : 'issue', 'reopen', target.url]
        if (comment) args.push('--comment', comment)
        await execGh(args, target.host)
    },
    comment: async (target, body) => {
        const args = [target.isPullRequest ? 'pr' : 'issue', 'comment', target.url, '--body', body]
        await execGh(args, target.host)
    },
    // Name-based (project number + owner + item URL + field name + option
    // name), not the ID-based `--id/--field-id/--project-id` form: `gh
    // project item-edit` resolves all of those from names on its own
    // (confirmed by hand), so there's no need to thread through GraphQL node
    // IDs for status-change at all.
    setStatus: async (target) => {
        const args = [
            'project', 'item-edit', String(target.projectNumber),
            '--owner', target.ownerLogin,
            '--url', target.url,
            '--field', target.fieldName,
            '--value', target.status
        ]
        await execGh(args, target.host)
    }
}

// A write-action target URL must match the board's own host and be a
// well-formed issue/pull-request path — without this, a JWT caller could
// pass an arbitrary URL and have the hub shell out `gh issue close
// <attacker-controlled-url>` against it, the same SSRF-class exposure the
// board-add host allowlist closed for reads (hapi#238).
export type ValidatedItemUrl = { url: string; isPullRequest: boolean }

// Confirmed by hand: `gh issue/pr close|reopen|comment <url>` dials the URL's
// own embedded host for the network request regardless of GH_HOST or any
// other ambient config — `GH_HOST=github.com gh issue view
// https://attacker.example/o/r/issues/1` still attempts to connect to
// attacker.example. That makes this check the *only* real defense, not
// defense-in-depth alongside GH_HOST, so it rebuilds a canonical URL from
// validated parts rather than trusting the client-supplied string to reach
// `gh` unchanged — eliminates any risk of the hub's URL parser (WHATWG) and
// gh's own (Go's net/url) disagreeing on what a given string resolves to.
// Also derives `isPullRequest` from the validated path itself rather than
// trusting a client-supplied boolean, which could otherwise mismatch the
// actual resource and run the wrong `gh issue`/`gh pr` verb against it.
export function parseValidatedItemUrl(url: string, board: Pick<StoredTodoBoard, 'host'>): ValidatedItemUrl | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== 'https:') {
        return null
    }
    // `.host` (not `.hostname`) — a GHE board on a non-default port stores
    // `board.host` as `host:port` (parseProjectUrl captures everything up to
    // the next `/`), while `.hostname` silently drops the port. Comparing
    // against `.hostname` rejected every write for a port-qualified board
    // even though the board itself can be added and read fine (Codex
    // review); rebuilding the canonical URL from `.hostname` had the same
    // bug the other direction — it would have handed `gh` a URL pointed at
    // the default port instead of the board's actual one.
    if (parsed.host.toLowerCase() !== board.host.toLowerCase()) {
        return null
    }
    const match = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/.exec(parsed.pathname)
    if (!match) {
        return null
    }
    const [, owner, repo, kind, number] = match
    return {
        url: `https://${parsed.host}/${owner}/${repo}/${kind}/${number}`,
        isPullRequest: kind === 'pull'
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

/** Normalizes one of the four scalar-ish field-value shapes to a display string; returns null for a type this UI doesn't render (iteration, reviewer, etc.) rather than guessing. */
function formatCustomFieldValue(node: GhFieldValueNode | null | undefined): string | null {
    if (!node) return null
    switch (node.__typename) {
        case 'ProjectV2ItemFieldSingleSelectValue':
            return 'name' in node && node.name ? node.name : null
        case 'ProjectV2ItemFieldTextValue':
            return 'text' in node && node.text ? node.text : null
        case 'ProjectV2ItemFieldNumberValue':
            return 'number' in node && typeof node.number === 'number' ? String(node.number) : null
        case 'ProjectV2ItemFieldDateValue':
            return 'date' in node && node.date ? node.date : null
        default:
            return null
    }
}

function mapItems(response: GhProjectV2Response, statusFieldName: string): BoardItem[] {
    const nodes = response.data?.repositoryOwner?.projectV2?.items?.nodes ?? []
    const items: BoardItem[] = []
    for (const node of nodes) {
        if (!node?.content) {
            continue
        }
        const customFields: BoardItem['customFields'] = []
        for (const fieldValue of node.fieldValues?.nodes ?? []) {
            const fieldName = fieldValue?.field?.name
            // Excludes the dedicated Status field — already surfaced via
            // fieldValueByName/statusOrder, would otherwise duplicate here.
            if (!fieldName || fieldName === statusFieldName) continue
            const value = formatCustomFieldValue(fieldValue)
            if (value === null) continue
            customFields.push({ name: fieldName, value })
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
            body: node.content.body ?? null,
            isPullRequest: node.content.__typename === 'PullRequest',
            createdAt: node.content.createdAt ?? null,
            closedAt: node.content.closedAt ?? null,
            author: node.content.author ? { login: node.content.author.login, avatarUrl: node.content.author.avatarUrl } : null,
            assignees: (node.content.assignees?.nodes ?? []).filter((a): a is { login: string; avatarUrl: string } => a !== null),
            labels: (node.content.labels?.nodes ?? []).filter((l): l is { name: string; color: string } => l !== null),
            milestone: node.content.milestone ? { title: node.content.milestone.title, dueOn: node.content.milestone.dueOn } : null,
            customFields
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

// Board hosts default to github.com only — a board-add request's host comes
// straight from a JWT caller's POST body and is passed to `gh api
// --hostname`, which resolves credentials (including any
// GH_ENTERPRISE_TOKEN/GITHUB_ENTERPRISE_TOKEN) for that host. Without an
// allowlist, an attacker-controlled hostname in the URL would make the hub
// send its own enterprise token to that host. Operators who actually run a
// GHE board add it explicitly via HAPI_BOARD_ALLOWED_HOSTS.
function getAllowedBoardHosts(): string[] {
    const raw = process.env.HAPI_BOARD_ALLOWED_HOSTS?.trim()
    if (!raw) {
        return ['github.com']
    }
    return raw.split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
}

function toSummary(board: StoredTodoBoard): { id: string; label: string } {
    return { id: board.id, label: board.label }
}

// To-do boards are read with the hub process's own host-wide `gh` auth, not
// per-namespace credentials. On a hub with more than one JWT namespace, any
// namespace could otherwise request the configured board (which may name a
// real, non-public project via HAPI_BOARD_*) and get its titles and
// drafts back through the operator's own authenticated session. Scope the
// whole feature to the owner namespace, same pattern as hub-settings/usage.
const OWNER_ONLY_ERROR = 'To-do boards are only available to the hub owner'

export function createBoardRoutes(
    dataDir: string,
    runGraphql: (target: ProjectQueryTarget) => GhProjectV2Response | Promise<GhProjectV2Response> = runGhGraphql,
    runGraphqlTitle: (target: ProjectLookupTarget) => GhProjectTitleResponse | Promise<GhProjectTitleResponse> = runGhGraphqlTitle,
    runGraphqlView: (target: ProjectViewLookupTarget) => GhProjectViewResponse | Promise<GhProjectViewResponse> = runGhGraphqlView,
    actions: BoardItemActions = defaultBoardItemActions,
    runGraphqlMembership: (target: ProjectMembershipTarget) => GhResourceProjectMembershipResponse | Promise<GhResourceProjectMembershipResponse> = runGhGraphqlProjectMembership
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/todo-boards', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const boards = await loadBoards(dataDir)
        const body: BoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.post('/todo-boards', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = AddBoardRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string }' }, 400)
        }
        const target = parseProjectUrl(parsed.data.url)
        if (!target) {
            return c.json({ error: 'Could not parse a GitHub Projects URL (expected e.g. https://github.com/users/<handle>/projects/<n> or .../orgs/<org>/projects/<n>)' }, 400)
        }
        const allowedHosts = getAllowedBoardHosts()
        if (!allowedHosts.includes(target.host.toLowerCase())) {
            return c.json({ error: `Host "${target.host}" is not in the allowed board hosts (${allowedHosts.join(', ')}). Set HAPI_BOARD_ALLOWED_HOSTS to permit it.` }, 400)
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
            statusFieldName: DEFAULT_BOARD.statusFieldName,
            doneValues: DEFAULT_BOARD.doneValues,
            ...(target.viewNumber !== undefined ? { viewNumber: target.viewNumber } : {})
        }

        // "Add" always means add — the env/default board stays in the list
        // on the very first add rather than being silently dropped. Returning
        // the same `existing` reference back when the id already exists is
        // what makes this idempotent (see updateBoards' no-op write skip).
        const boards = await updateBoards(dataDir, (existing) =>
            existing.some(b => b.id === newBoard.id) ? existing : [...existing, newBoard]
        )

        const body: BoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.delete('/todo-boards/:id', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const id = c.req.param('id')
        // Removing the last board now genuinely empties the list (hapi#238
        // — the frontend's explainer handles that state), not re-seeded with
        // the demo default. Returning `existing` unchanged for an id that
        // was never there keeps this a true no-op (skips the write) rather
        // than silently pinning the env-derived seed into settings.json for
        // nothing.
        const boards = await updateBoards(dataDir, (existing) => {
            const filtered = existing.filter(b => b.id !== id)
            return filtered.length === existing.length ? existing : filtered
        })

        const body: BoardsResponse = { boards: boards.map(toSummary) }
        return c.json(body)
    })

    app.get('/todo-boards/:id/items', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const boards = await loadBoards(dataDir)
        const board = boards.find(b => b.id === c.req.param('id'))
        if (!board) {
            return c.json({ error: 'Unknown board' }, 404)
        }

        try {
            const ghResponse = await runGraphql(board)
            if (ghResponse.errors?.length) {
                return c.json({ error: ghResponse.errors.map(e => e.message).join('; ') }, 502)
            }

            const projectV2 = ghResponse.data?.repositoryOwner?.projectV2
            if (!projectV2) {
                // GitHub can return `projectV2: null` with no top-level error
                // (owner exists, project number doesn't or isn't visible to
                // the active gh identity) — without this check the route
                // would 200 with an empty board instead of surfacing why.
                return c.json({ error: 'Project not found, or not accessible with the current gh auth' }, 404)
            }
            if (!Array.isArray(projectV2.field?.options)) {
                // `field(name: $statusField)` resolves to null when no field
                // has that name at all — but when a field DOES exist with
                // that name and just isn't a single-select, the inline
                // `... on ProjectV2SingleSelectField { options { name } }`
                // fragment simply doesn't match and `field` comes back as an
                // empty object (truthy!), not null. Checking `options` is an
                // array catches both shapes instead of silently dumping
                // every item into "No status" for the second one.
                return c.json({ error: `Status field "${board.statusFieldName}" was not found, or is not a single-select field, on this project` }, 502)
            }

            const statusOrder = projectV2.field.options.map(o => o.name)
            const body: BoardItemsResponse = {
                board: toSummary(board),
                statusOrder,
                doneValues: board.doneValues,
                items: mapItems(ghResponse, board.statusFieldName)
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

    async function requireBoardAndValidUrl(
        boardId: string,
        url: string
    ): Promise<
        | { ok: true; board: StoredTodoBoard; url: string; isPullRequest: boolean }
        | { ok: false; error: string; status: 400 | 404 | 502 }
    > {
        const boards = await loadBoards(dataDir)
        const board = boards.find(b => b.id === boardId)
        if (!board) {
            return { ok: false, error: 'Unknown board', status: 404 }
        }
        const validated = parseValidatedItemUrl(url, board)
        if (!validated) {
            return { ok: false, error: 'Item URL does not belong to this board', status: 400 }
        }
        // Host + path shape alone don't prove this issue/PR is actually on
        // the board's project — a project can contain items from any repo on
        // its host. Without this, an authenticated owner-namespace caller
        // could use the hub's `gh` credentials to close/reopen/comment on any
        // same-host issue or PR, not just ones on this board (Codex review).
        let membership: GhResourceProjectMembershipResponse
        try {
            membership = await runGraphqlMembership({
                host: board.host,
                url: validated.url,
                ownerLogin: board.ownerLogin,
                projectNumber: board.projectNumber
            })
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Failed to verify item membership', status: 502 }
        }
        // A parseable response can still carry a GraphQL-level error (partial
        // data from a scope/resolver failure) alongside an empty/missing
        // `projectItems` — without this check, that reads identically to
        // "genuinely not a member" and 400s with a misleading message instead
        // of the 502 every other GraphQL failure in this file gets (Codex
        // review).
        if (membership.errors?.length) {
            return { ok: false, error: membership.errors.map(e => e.message).join('; '), status: 502 }
        }
        if (!isMemberOfProject(membership, board.ownerLogin, board.projectNumber)) {
            return { ok: false, error: 'Item is not part of this board', status: 400 }
        }
        // A view-scoped board exists specifically to restrict exposure to a
        // filtered subset of the project's items — project membership alone
        // isn't enough here, or a write could reach an item the view's
        // filter deliberately hides (Codex review). Reuses the exact
        // view-filtered items fetch the read path already makes (same
        // runGraphql call, same view→itemsFilter resolution) rather than
        // re-implementing GitHub's view-filter query syntax server-side.
        if (board.viewNumber !== undefined) {
            let itemsResponse: GhProjectV2Response
            try {
                itemsResponse = await runGraphql({
                    host: board.host,
                    ownerLogin: board.ownerLogin,
                    projectNumber: board.projectNumber,
                    statusFieldName: board.statusFieldName,
                    viewNumber: board.viewNumber
                })
            } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : 'Failed to verify item is visible in this view', status: 502 }
            }
            if (itemsResponse.errors?.length) {
                return { ok: false, error: itemsResponse.errors.map(e => e.message).join('; '), status: 502 }
            }
            const visibleItems = mapItems(itemsResponse, board.statusFieldName)
            if (!visibleItems.some(item => item.url === validated.url)) {
                return { ok: false, error: 'Item is not visible in this board\'s view', status: 400 }
            }
        }
        return { ok: true, board, url: validated.url, isPullRequest: validated.isPullRequest }
    }

    app.post('/todo-boards/:id/items/close', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = BoardItemCloseRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string, comment?: string }' }, 400)
        }
        const resolved = await requireBoardAndValidUrl(c.req.param('id'), parsed.data.url)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        try {
            await actions.close({ host: resolved.board.host, url: resolved.url, isPullRequest: resolved.isPullRequest }, parsed.data.comment)
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to close item' }, 502)
        }
    })

    app.post('/todo-boards/:id/items/reopen', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = BoardItemReopenRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string, comment?: string }' }, 400)
        }
        const resolved = await requireBoardAndValidUrl(c.req.param('id'), parsed.data.url)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        try {
            await actions.reopen({ host: resolved.board.host, url: resolved.url, isPullRequest: resolved.isPullRequest }, parsed.data.comment)
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to reopen item' }, 502)
        }
    })

    app.post('/todo-boards/:id/items/comment', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = BoardItemCommentRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string, body: string }' }, 400)
        }
        const resolved = await requireBoardAndValidUrl(c.req.param('id'), parsed.data.url)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        try {
            await actions.comment({ host: resolved.board.host, url: resolved.url, isPullRequest: resolved.isPullRequest }, parsed.data.body)
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to comment on item' }, 502)
        }
    })

    app.post('/todo-boards/:id/items/status', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = BoardItemStatusRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body — expected { url: string, status: string }' }, 400)
        }
        const resolved = await requireBoardAndValidUrl(c.req.param('id'), parsed.data.url)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        try {
            await actions.setStatus({
                host: resolved.board.host,
                ownerLogin: resolved.board.ownerLogin,
                projectNumber: resolved.board.projectNumber,
                url: resolved.url,
                fieldName: resolved.board.statusFieldName,
                status: parsed.data.status
            })
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to update status' }, 502)
        }
    })

    return app
}
