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

---

## Round 2 — cli green, web down to 4 (2026-11-09)

Everything below the upstream merge is now resolved except one cluster. Current WIP: `b6b401ea6`.

**Cleared since the first writeup:**

| Was failing | Cause | Fix |
|---|---|---|
| `AcpSdkBackend` hybrid (2 errors) | took upstream for 2 hunks, rest auto-merged to soup's older file | rebuilt on upstream + re-applied the one surviving soup delta (`2e40d38f9` child cwd). Diff vs upstream was 47 lines and cwd was the only fork-unique content. |
| `cursorAcpRemoteLauncher` steer shape | local annotation restated the backend's type | now `ReturnType<typeof backend.beginSoftSteerPrompt>` |
| 3× `runAgy.test.ts` | **my own bad fix.** I deleted `return selection` after reading `sessionConfigRpc.ts` and seeing the result discarded — but that was the *hybrid* file. Upstream widens `onApply` to return `SessionConfigState` and does `Object.assign(applied, normalized)`. | took upstream's `sessionConfigRpc.ts` (7-line diff, no fork content), restored the return |
| `ToolCard`, `knownTools`, 2× `_results` | upstream additions dropped where the fork's older region won the auto-merge: lowercase `read` predicate + registry entry, `knownTools` `read` entry + `filePath` key, `isTerminalToolBlock` threading + `startUnavailable` | took upstream for each after confirming no fork content in the diff |
| 4× `NewSession` (first pass) | test mock lost its cancel button | restored upstream's mock shape |

**cli/hub/web/relay typecheck clean. cli 4584 passed. web 4547 passed / 4 failed.**

## The remaining 4 — genuine divergence, not a merge drop

`NewSession/index.test.tsx > preserves hub $agent/$permissionMode after cancel and remount` (codex/read-only ×2, claude/plan, cursor/plan).

- The mocks are byte-identical to upstream; `permission-mode` renders `props.nativeValue`, and the fork is not seeding it from hub `peerSpawnDefaults` on the cancel-and-remount path.
- `nativePermissionMode` state, the `nativeValue=` wiring, and the "Seed from hub peerSpawnDefaults once" block are all structurally identical to upstream — so the gate is elsewhere.
- **`web/src/components/NewSession/index.tsx` diverges from upstream by 359 lines** (fork board-spawn semantics, `seedComposerDraftIfEmpty`, the fresh-spawn-only `onSpawned` contract; upstream has opencode import + claude model/effort pickers). Whoever resumes needs to know which gate the fork added, not guess.

**Do not delete these tests to go green.** They are upstream tests for upstream behaviour that arrived legitimately with the merge. Conflict-resolution-by-deletion is precisely how the fork lost resolve-by-`agentSessionId` on 11-05 — see `2026-11-08-ancestry-vs-presence-verification-gap.md`. Either port the behaviour or record, in the test, why the fork's spawn flow intentionally differs.

**Still deferred regardless of the above:** `hapi-restart-hub` — operator mid bring-up on `gc-in-linux`.
