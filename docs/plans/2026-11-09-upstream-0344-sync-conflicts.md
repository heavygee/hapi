# Fork main → upstream 0.34.4 sync: conflicts scouted, deliberately not resolved (2026-11-09 ~03:30)

**State:** fork `main` at `46798ffc7`, **10 behind `upstream/main`** (`2161a9ff9`, release 0.34.4). Live soup tip `ff7e86490` is green and serving; **nothing is blocked**. Mirror is clean — the trial merge was aborted, no trace left.

## Why this was attempted now

The next compose request will refuse at step one (`hapi-driver-rebuild` fails closed when fork main is behind upstream), forcing `hapi-sync-fork-main` *during* someone's request. That is exactly how 2026-11-08 went: a routine `#308` compose pulled upstream `2524f8161` (agy ACP) in as a side effect, producing 14 conflicts, an `AcpSdkBackend` reconciliation, and four regressions. Scouting the sync while no one is waiting is strictly better than discovering it mid-request.

The scout was worth it: **the sync conflicts.**

## The three conflicts

| File | Hunks | Shape |
|---|---|---|
| `cli/src/index.ts` | 1 | **Resolved in the trial** — pattern below |
| `cli/src/claude/utils/startHappyServer.ts` | 2 | not inspected |
| `cli/src/modules/pingPeer/pingPeer.ts` | 3 | **interleaved** — see below |

### `cli/src/index.ts` — union, pattern established

Upstream restructured the entry point into `async function main()` with `handleDisclaimExecEntry()` (macOS responsibility re-exec before module side effects) and dynamic imports. The fork had added a try/catch backstop around `runCli()` whose own comment explains it: commands normally call `process.exit` themselves, so an unhandled rejection would otherwise fall through as **exit 0** — "the silent-success class that made expired JWTs look like no matches".

**Take upstream's `main()`, keep the fork's backstop wrapped around `await runCli()`.** Taking upstream wholesale silently drops a safety property that exists because it already bit someone.

### `cli/src/modules/pingPeer/pingPeer.ts` — why this one stopped the attempt

Upstream brings `f34ff13fc feat(peer): forward peer replies back to the caller with waitForReply (#2167)`, which adds `isReadyEvent()` and related machinery. The fork has its inspect-messages paging (`InspectMessagesFetch`, `MAX_INSPECT_PAGES`, snapshot/seq cursors).

These are **independent additions at the same location**, not competing versions of the same code — so neither side may simply win. Worse, the conflict boundary cuts **through a type declaration**: HEAD's side opens `type InspectMessagesFetch = {` and the post-conflict text continues that type, while upstream's side is a complete function. Naive "keep both" inserts a function body inside a type literal. The union needs correct *ordering*, not concatenation.

**This file has form.** `pingPeer.ts` is where resolve-by-`agentSessionId` (fork #137, Fixes #1203) was silently deleted on 2026-11-05 by `1b4438be5` — a −426/+184 rewrite made while "clearing remat verify CLI failures". That loss was invisible for three days and surfaced as three agents unable to cite each other. See `2026-11-08-ancestry-vs-presence-verification-gap.md`.

## Why it was aborted rather than finished

Deliberate, and distinct from over-caution:

- **Fork `main` is shared.** A bad resolution here reaches every peer immediately. The 11-08 bad resolutions were on a WIP branch, caught by `--verify` before promote; there is no such gate on main.
- **Measured error rate.** Of 14 conflicts resolved on 11-08, four produced regressions — including one that let a sticky preference nobody set override the operator's hub config.
- **Green is not sufficient here.** The 11-05 loss *passed* verify; no test covered the deleted feature. So "suites green" would not prove the union preserved both sides.
- **Nothing is blocked.** No compose is queued; the live tip is verified serving.

## Next session: how to do it

1. `hapi-sync-fork-main` (it will conflict again — expected).
2. `index.ts`: apply the union above.
3. `pingPeer.ts`: resolve by **ordering**, not concatenation. Put upstream's self-contained `isReadyEvent()` *before* the fork's partial type declaration so the post-conflict continuation still attaches to its own type.
4. **Symbol-preservation check, not just tests.** Diff the exported/declared symbol set of each conflicted file against *both* parents; anything present in either parent and absent after the merge is a silent drop. This is the check that would have caught 11-05, and the one `--verify` cannot do.
5. Full typecheck + suites, then push.
6. Only then remat, so the soup absorbs 0.34.4 deliberately rather than as a side effect.

Upstream 0.34.4 also carries `#2312` (peer session MCP tools) and a new `enabledTools` allowlist wrapper around `registerTool()` — a peer hit that on `#2147` and broke two of upstream's own tests by folding fork tools in unconditionally. Expect it to matter at remat.
