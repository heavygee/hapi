# #308 remat — blocked on upstream ACP interface reconciliation (2026-11-08)

**Owner:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d) · **State:** remat hold ACTIVE (`reason: typecheck failed`) · **Live tip:** `c5a182a12` **unchanged** (atomic rollback held)

Resume notes so this does not have to be re-derived.

## How we got here

1. `#308` (`driver/mcp-always-load-meta` @ `d4d16dd65`) compose requested; manifest `dee98ed7c` verified on `origin/main`; precheck idle.
2. First `hapi-driver-rebuild` **refused**: fork main was 2 behind `upstream/main`. Required remedy is `hapi-sync-fork-main` — so the compose pulled in upstream `2524f8161` (**agy over ACP, #2319**) as a side effect. That bump, not #308, is the source of everything below.
3. Merge of `origin/main` into `driver/integration-wip`: **14 conflicts**, resolved and committed as `30a921711`.
4. Remat resumed (`HAPI_REMAT_RESUME=1`) → **typecheck failed** → live tip rolled back, hold set.

## Conflict resolutions already committed (`30a921711`)

| Area | Resolution |
|---|---|
| `cli/src/agy/**` | Upstream renamed `headless/`+`utils/` → `legacyStreamJson/` and added the ACP launcher. **Took upstream wholesale** — the only soup delta in that subtree is `runAgy.ts`, which merged cleanly. |
| `config/driver-manifest.yaml` | **Took `origin/main`** (fork main owns the manifest under split-lane). Drops `driver/2267-post-close-silence` (merged upstream as #2268), adds `driver/mcp-always-load-meta`. |
| `_results.tsx` | **UNION, not a take.** Fork's `isSubagentToolName` → `MarkdownResultView` branch and `OPENCODE_RESULT_VIEW_ALIASES` (absent upstream) kept and resolved first; upstream's `resolveToolNameAlias` lookup + terminal-block fallback appended. Either side alone drops live behaviour. |
| `AcpSdkBackend` (2 hunks), `ToolCard.tsx`, `modes.ts`, `syncEngine.ts`, `docs/guide/agents.md`, 2 test files | Upstream-only evolution, no soup delta → took upstream. |
| `steerQueuedMessage.test.ts` | Not a conflict — auto-merge kept soup's import block with upstream's new test body. Added `spyOn` + `RpcGateway` imports. Fixed; hub typecheck now clean. |

## What is still red

```
cli/src/agy/agyAcpRemoteLauncher.ts(297,300): Property 'supportsSessionResume' / 'resumeSession'
                                               does not exist on type 'AcpSdkBackend'
cli/src/cursor/cursorAcpRemoteLauncher.ts(592): { dispatched; answered; completed: Promise<string|null> }
                                               not assignable to { dispatched; completed: Promise<void> }
cli/src/agy/runAgy.ts(128):                    Promise<AgyModelSelection | undefined> not assignable
                                               to void | Promise<void>
```

**Root shape:** taking upstream for two hunks of `AcpSdkBackend.ts` left a **hybrid file** — the rest auto-merged to soup's older version, so upstream's new methods are missing while upstream's new call sites expect them.

**`AcpSdkBackend.ts` cannot be resolved by taking either side.** Soup carries four fork commits in it:

- `7c7a23e85` harden post-done seal against queue race / false closes
- `a59c9b699` seal done footer before quiet-drain harness coalescing
- `524e33dfa` discard suppressed harness buffers before next prompt
- `2e40d38f9` spawn ACP agent with session cwd for MCP project config

Taking upstream drops all four (live post-done seal + MCP project config behaviour). Keeping soup leaves `agyAcpRemoteLauncher` unbuildable.

## Resume plan

1. **Union `AcpSdkBackend.ts`**: keep the four soup deltas, add upstream's `answered` promise, `supportsSessionResume`, `resumeSession`, and `completed: Promise<string|null>` (+ `extractPromptUsage` / `readLatestUsageUpdate` call sites).
2. **Adapt `cursorAcpRemoteLauncher.ts:592`** to the widened request shape — it is soup-modified, so adapt rather than overwrite.
3. **`runAgy.ts:128`** — soup's `onConfigChange` returns `AgyModelSelection`; upstream narrowed the callback to `void | Promise<void>`. Wrap or widen; do not drop the soup return path without checking what consumes it.
4. `bun run typecheck` in `~/coding/hapi/worktrees/driver-remat` until clean, commit on WIP, then
   `HAPI_REMAT_RESUME=1 HAPI_REMAT_OWNER=1 HAPI_REMAT_OWNER_TOKEN=… HAPI_AGENT_LABEL=tooling-meta hapi-driver-rebuild --build-web --verify`.
5. Post the new tip SHA to [Peer #310](/sessions/ad24ecf0-6367-4eb2-ac0d-10ef870c7414) (waiting to re-thin `driver/slim-session-job-mcp`, manifest already on main @ `836eb8cdc`) and to [Peer #308](/sessions/5d5d200a-a340-4b31-bd26-2c2668e6cf67).
6. `hapi-restart-hub` (patient) — **deferred tonight**: operator mid bring-up on `gc-in-linux`, overseer asked for no stack disturbance.

## Gotchas worth keeping

- **The hold guard reads `HAPI_REMAT_OWNER` from its own process env**, not the command string, so inline `VAR=… cmd` cannot satisfy it from an agent shell. Sanctioned path: owner-clears the hold, then re-runs with `HAPI_REMAT_RESUME=1` to preserve the WIP merge commit. Do not reshape the command to dodge the hook.
- **Piping the rebuild through `tail` destroys its exit code** — the pipeline returns `tail`'s status. Both failures tonight reported exit 0 while the log said `ERROR`. Redirect to a file and check the script's own status.
- `hapi-sync-fork-main` is a *required* precondition that can silently enlarge the job: it pulled a major upstream refactor into a routine compose.
