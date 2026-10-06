# Peer briefing — cursor ACP remote resume session-ready timeout

**Branch:** `fix/cursor-acp-remote-resume-ready`
**Worktree:** `~/coding/hapi/worktrees/cursor-acp-remote-resume/`
**Tracker:** [tiann/hapi#991](https://github.com/tiann/hapi/issues/991)
**Parent orchestrator HAPI:** `4afb9884-8262-4eff-a519-635d23741f5e`

## Operator report (2026-07-03)

`POST /api/sessions/:id/resume` on inactive Cursor ACP sessions → **HTTP 500 ~61s** (`Session failed to become ready`). Runner online, spawns fine. CLI reaches ACP + Waiting for messages; hub never sees `session-ready` within 60s.

**Topology:** hub on `oos-linux`, runner on `proxmox`, `HAPI_API_URL` = tailnet. Universal HAPI bug, not lockhouse-specific.

**Workaround:** `runCursor({ existingSessionId, resumeSessionId, startedBy:'runner' })` on original row.

**Sessions repro'd:** `5868d461`, `6e750e05`, `eea10c8d` (cursorSessionId `d1ceebab-27db-4601-9b9d-00a5c5bc7c3f`).

## Intake status (orchestrator completed)

- [x] **1 Code search** — `resumeSession` spawn-then-merge; `waitForSessionReady` polls in-memory `sessionReadyIds`; `existingSessionId` exists in `runCursor` but not on resume spawn path.
- [x] **2 Upstream search** — #939/#948 fixed premature merge; #917 different (post-load death); **no issue** for remote socket session-ready timeout with live CLI.
- [x] **3 Playback** — operator handoff via CursorRemote recovery session.
- [x] **4 Issue** — filed at spawn.
- [x] **5 Demo topology** — **operator prod** (remote hub+runner) for dogfood; peer-stack insufficient alone for tailnet falsification.

## Your assignment

**Own:** root-cause fix → tests → cold review → operator dogfood on **remote topology** → upstream PR.

### Priority fix directions (pick minimal correct fix first)

1. **CLI:** resume spawn passes `existingSessionId` — reuse original HAPI row (operator workaround as product).
2. **Hub:** persist `session-ready` or query CLI state instead of in-memory-only `sessionReadyIds`.
3. **Hub:** dedup resume — reject if same `cursorSessionId` already spawning/live.
4. **Socket:** investigate tailnet websocket drops; ready retry.

### Do NOT

- Bulk-reopen archived sessions (#917 lesson)
- `hapi-use-worktree` / `hapi-use-driver` / `hapi-driver-rebuild --activate` without operator approval
- Manual hub on `:3006` from worktree

### Gates (intake §6)

1. `bun typecheck` + `bun run test` (hub + cli focus)
2. Cold review vs `upstream/main`
3. **Falsification test:** document localhost pass vs tailnet fail before fix; tailnet pass after fix
4. Hub/cli only — **no web Playwright tier** unless UI error surfacing changes

### Ping back

```bash
hapi-ping-peer 4afb9884 "Peer #991: fix/cursor-acp-remote-resume-ready — gates pass, ready for remote dogfood"
```

## Key files

- `hub/src/sync/syncEngine.ts`
- `hub/src/socket/handlers/cli/sessionHandlers.ts`
- `cli/src/cursor/cursorAcpRemoteLauncher.ts`
- `cli/src/cursor/runCursor.ts`
- `hub/src/sync/sessionModel.test.ts`

## Related

- #939 CLOSED / #948 merged
- #917 OPEN (cross-link, different failure)
- #913, #841 OPEN

---

## Orchestrator recovery handoff (2026-07-03 afternoon, CursorRemote session)

**Context:** While Peer #991 was mid soup investigation, operator asked to safely reopen five archived/inactive sessions on **original HAPI IDs** (not hub Resume). Recovery orchestrator: CursorRemote agent (`8dda7bbc…`).

### Root cause confirmed (matches #991)

`syncEngine.resumeSession` → spawn new row via `hapi cursor --resume` → `waitForSessionReady` (60s, in-memory `sessionReadyIds`) → merge. Tailnet hub (`oos-linux` `.79`, `hapi-hub-oos.service`) + proxmox runner: socket `session-ready` often lost → **500 resume_failed**. **Not** missing runner.

**Working workaround:** `runCursor({ existingSessionId, resumeSessionId, startedBy:'runner', permissionMode:'yolo' })` — no spawn-then-merge.

### Driver soup state when recovery started

`/home/heavygee/coding/hapi/driver` on `driver/integration` had **in-progress merge** with `feat/cursor-model-error-bridge`. Conflict markers in `cli/src/cursor/cursorAcpRemoteLauncher.ts` (and others) crashed Bun. Emergency fix: `git checkout --ours` on conflicted files to restore runnable CLI. **Merge still unresolved** — Peer #991 or model-error-bridge peer must finish properly; do not treat `--ours` as final.

### Sessions reopened (safe path)

| Session | HAPI ID | Status after recovery |
|---------|---------|------------------------|
| model-error-bridge | `902b7f8a…` | **active** |
| meta - PR watcher | `9f5f7e1d…` | **active** |
| PR #958 inline images | `8b90bf6e…` | **active** |
| Peer #921 scratchlist | `e89a99c7…` | **active** |
| workstation runbook | `6e750e05…` | **intermittent** — earlyoom kills 5th concurrent ACP agent on proxmox (~6–7% MemAvailable, swap 0%) |

**Do NOT** use web UI **Resume** on inactive ACP sessions until #991 fix ships — each click spawns orphan row + competing `agent acp`.

### Extra fixes applied during recovery

1. **`6e750e05` agent_state validation:** DB had `completedRequests` entry missing required `arguments` → CLI `getSession` Zod fail. Reset on oos-linux: `agent_state='{"controlledByUser":false,"requests":{},"completedRequests":{}}'`. Hub **in-memory cache** served stale state until hub process bounced (`hapi-hub-oos` on `.79`).
2. **Hub restart side effect:** killing/restarting oos-linux hub archived live sessions with `archiveReason: Hub restart` (runnerLifecycle default on SIGTERM). Safe-revive clears via `updateMetadata` → `lifecycleState: running` on bootstrap.
3. **Parallel revive failures:** launching 5 revives at once → processes **Killed** (OOM/earlyoom). **Sequential** revive with `--detach` required.

### Tooling created (operator question: temp vs persist)

| Path | Verdict |
|------|---------|
| `/tmp/safe-revive-session.sh`, `/tmp/safe-revive-session-nohup.sh` | **Ephemeral** — delete when done |
| `~/coding/hapi/scripts/tooling/hapi-safe-revive-session.sh` | **Canonical fork tooling** — commit to fork `main` per `docs/tooling/driver-soup.md` (operator scripts live in `scripts/tooling/`, installed to `~/.local/bin/` via existing install path). **Temporary workaround** until #991 in soup; then demote/remove or fold into product resume. |

**Not the same as** `hapi-resurrect-session.sh` — that targets legacy stream-json / missing `cursorSessionId` and calls broken `POST /resume`.

### Peer #991 action items (add to your queue)

1. **Incorporate workaround as product fix** (your priority #1 in briefing above).
2. **Review driver merge state** — who left conflict markers, finish merge without blind `--ours`.
3. **Optional:** hub-side `clearSessionArchiveMetadata` + safe-revive in one operator command (reopen without broken resume spawn).
4. **Document** tailnet falsification + session-ready persistence in #991 PR body.

### Ping orchestrator when gates pass

```bash
hapi-ping-peer 4afb9884 "Peer #991: incorporated recovery handoff + safe-revive tooling path"
```
