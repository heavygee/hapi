# HAPI peer stack (isolated hub + web + runner) — implementation plan

> **For dedicated agent:** REQUIRED — read this entire file, then `docs/operator/AGENTS.md`, then implement task-by-task. Do not stack-switch `:3006`.

**Goal:** Every feature peer can spin up a **fully isolated** HAPI stack from their worktree (hub + built web + runner), run Playwright against the **real session UI**, capture PNG/GIF/MP4 handoff evidence, and tear down — **without touching** the live daily driver on `:3006`.

**Architecture:** User-level processes only. Isolation via existing env knobs (`HAPI_HOME`, `HAPI_LISTEN_PORT`, `HAPI_API_URL`, `CLI_API_TOKEN`). A registry under `~/.hapi-peer/` tracks port blocks, PIDs, and worktree paths. Playwright reads `HAPI_PEER_*` from a gitignored env file. Fixture-based e2e remains a **CI supplement**; peer handoff requires **peer-stack** evidence.

**Tech stack:** Bash orchestration (`scripts/tooling/`), Bun hub/cli from worktree, `web/dist` served by hub, Playwright (`@playwright/test`), optional ffmpeg trim, `hapi-display-image.mjs` for inline HAPI chat posts.

**Trigger:** Operator decision 2026-06-20 — fixture + soup dogfood is not acceptable default proof for web UX; isolated stack should be normal peer workflow.

---

## Problem

Feature peers today prove web UX with:

1. **Vite fixtures** on `:5179` (no hub; fake chrome) — passes gates but is not the product UI.
2. **Soup dogfood** on `:3006` after operator rebuild — real UI but shared stack, agent-forbidden stack switches, and not peer-automatic.

Intake §5 documents **clean instance** (separate hub on new port) as operator-manual Proxmox setup. Nothing packages that for agents. Peers take the path of least resistance.

**Operator expectation:** peer agent stands up isolated stack → Playwright on `/sessions/...` → record animation → post to HAPI chat → `down`. Live `:3006` never involved.

---

## Non-goals (v1)

- Replacing production systemd services or `hapi-active`.
- Tailscale / relay / Telegram on peer stacks (disabled by default).
- Multi-machine Proxmox provisioning (peer stack is **local** on the dev host).
- Upstream PR in the first slice (fork tooling + docs first; upstream extraction is Phase 2 optional).

---

## Design

### Isolation contract

| Resource | Production (`:3006`) | Peer stack |
|---|---|---|
| Hub port | `3006` | `3100–3199` (allocated) |
| `HAPI_HOME` | `~/.hapi` | `~/.hapi-peer/<stack-name>/` |
| Hub + runner processes | systemd | user background PIDs |
| Web assets | driver soup | **worktree** `web/dist` |
| Notifications | enabled | **off** (no bot token) |
| Agent stack switches | operator only | **never** (`hapi-use-driver` still forbidden) |

### Port allocation

- Base hub port: `3100 + slot` where `slot` is first free integer `0..99` in registry.
- Optional Vite dev mode (Phase 2): `5170 + slot` with `VITE_HUB_PROXY` — v1 uses **hub-served `web/dist`** only (production-faithful).
- Runner control HTTP: ephemeral (`port: 0` in `controlServer.ts`) — no registry entry needed.

### Registry

`~/.hapi-peer/registry.json`:

```json
{
  "stacks": {
    "scratchlist-959": {
      "worktree": "/home/heavygee/coding/hapi/worktrees/scratchlist-exit-after-send",
      "hubPort": 3107,
      "hapiHome": "/home/heavygee/.hapi-peer/scratchlist-959",
      "hubPid": 12345,
      "runnerPid": 12346,
      "cliApiToken": "<generated>",
      "sessionId": "<seeded>",
      "startedAt": "2026-06-20T12:00:00Z",
      "envFile": "localdocs/peer-stack.env"
    }
  }
}
```

### CLI surface

Install symlink or PATH entry (match existing tooling pattern):

```bash
hapi-peer-stack up   [--name NAME] [--worktree PATH] [--no-runner] [--no-seed]
hapi-peer-stack down [--name NAME] [--wipe]
hapi-peer-stack status [--name NAME | --all]
hapi-peer-stack doctor              # ports, stale PIDs, TTL warnings
```

**Agent-safe:** These commands do **not** touch `:3006`, systemd, or `hapi-active`. Document in `.cursor/rules/operator-fork.mdc` allowlist alongside `hapi-driver-rebuild` (without `--activate`).

### `up` sequence

1. Resolve worktree (default `$PWD`, must be under `~/coding/hapi/worktrees/` or legacy layout).
2. Refuse if production hub port `3006` would be used (sanity).
3. Allocate stack name + port + `HAPI_HOME` dir.
4. Generate `CLI_API_TOKEN` (uuid or `openssl rand -hex 32`).
5. **Build:** `cd "$WORKTREE" && bun install --frozen-lockfile` (if needed) && `bun run build:web`.
6. **Start hub** (background, log to `$HAPI_HOME/hub.log`):

   ```bash
   export HAPI_HOME="$PEER_HOME"
   export HAPI_LISTEN_HOST=127.0.0.1
   export HAPI_LISTEN_PORT="$HUB_PORT"
   export CLI_API_TOKEN="$TOKEN"
   export TELEGRAM_BOT_TOKEN=
   export HAPI_PUBLIC_URL="http://127.0.0.1:$HUB_PORT"
   cd "$WORKTREE/hub"
   bun run src/index.ts &
   ```

7. **Wait for health:** `GET http://127.0.0.1:$HUB_PORT/health` (already `hub/src/web/server.ts` — `{ status: 'ok', protocolVersion }`).
8. **Start runner** (unless `--no-runner`):

   ```bash
   export HAPI_HOME="$PEER_HOME"
   export HAPI_API_URL="http://127.0.0.1:$HUB_PORT"
   export CLI_API_TOKEN="$TOKEN"
   cd "$WORKTREE/cli"
   bun run src/index.ts runner start-sync \
     --workspace-root "$WORKTREE" \
     --workspace-root "$HOME/coding" &
   ```

9. **Seed session** (unless `--no-seed`): run `scripts/dev/seed-peer-session.mjs` → `{ sessionId, webAccessToken }`.
10. Write `localdocs/peer-stack.env` in worktree (gitignored).
11. Update registry; print human summary + JSON for scripts.

### `down` sequence

1. Read registry; SIGTERM runner then hub (grace 5s, SIGKILL).
2. Remove registry entry.
3. `--wipe`: delete `$HAPI_HOME` directory.

### TTL watchdog

`hapi-peer-stack doctor` warns on stacks older than `HAPI_PEER_STACK_TTL_HOURS` (default `4`). Optional cron-friendly `hapi-peer-stack gc` kills expired stacks. Prevents leaked processes when peers forget `down`.

---

## Playwright integration

### Config changes (`playwright.config.ts`)

- Read `process.env.HAPI_PEER_WEB_URL` — when set, **disable** fixture `webServer` block and set `use.baseURL` to peer URL.
- Keep fixture mode as fallback when env unset (CI without stack).
- Add npm script:

  ```json
  "test:e2e:peer": "node scripts/dev/run-e2e-on-peer-stack.mjs"
  ```

`run-e2e-on-peer-stack.mjs`:

1. `hapi-peer-stack up` (or require already-up via env)
2. `source localdocs/peer-stack.env` equivalent in Node
3. `playwright test "$@"` with `HAPI_PEER_WEB_URL` set
4. On success/failure: optional `--keep` flag; default `down` in CI, keep locally for debugging

### Real session spec pattern

New spec or migrate `e2e/scratchlist-exit-after-queue-peer.spec.ts`:

- Load session id + token from env.
- `addInitScript` localStorage pattern from `scripts/dev/session-view-toggles-handoff.mjs`:

  ```javascript
  const storageKey = `hapi_access_token::${baseUrl}`
  localStorage.setItem(storageKey, token)
  ```

- Navigate `/sessions/${sessionId}`.
- Assert real scratchlist toggle, drawer, send routing — **no fixture HTML**.
- `recordVideo` → ffmpeg trim → `localdocs/playwright-runs/<feature>.mp4`.

### Handoff script template

`scripts/dev/scratchlist-exit-after-queue-handoff.mjs` — peer-stack variant of session-view toggles:

- Args: `[stack-name]` or reads `localdocs/peer-stack.env`.
- Drives interaction + screenshot + optional video path stdout JSON.
- Document as canonical example in intake §6.4.

---

## Session seeding (`scripts/dev/seed-peer-session.mjs`)

**Inputs:** `--hub-url`, `--token`, optional `--title`.

**Behavior:**

1. Use hub REST to create a minimal remote session (discover endpoint in `hub/src/web/routes/sessions.ts` — likely `POST /api/sessions` or RPC path).
2. If REST create requires runner: document fallback — insert minimal row via hub internal API or use `spawnRunnerSession` control client against peer runner.
3. Mint or reuse web JWT for Playwright (`/api/auth` or whatever login flow uses — mirror `session-view-toggles-handoff.mjs` token injection if JWT is CLI token shaped).
4. Print JSON: `{ sessionId, webAccessToken, hubUrl }`.

**Spike task:** First implementation step is read-only discovery of smallest viable seed path; document chosen path in this plan's "Live evidence" section when done.

---

## Intake / policy updates (mandatory before calling v1 done)

### `docs/tooling/new-feature-intake.md`

- §5: Add **Peer stack (local, default for feature peers)** before soup/clean table.
- Mermaid: new node `M -->|Peer stack| P2[Worktree + hapi-peer-stack up]`.
- §6.4: Change "fixture or demo URL" → **peer stack URL required** for web handoff; fixture allowed for CI-only fast path.
- §0 handoff template: `- [ ] 5 Demo topology — peer stack — localdocs/peer-stack.env`.

### `docs/operator/AGENTS.md`

- Short paragraph: peers use `hapi-peer-stack`, not soup, for pre-operator gates.

### `.cursor/rules/operator-fork.mdc`

- **Allow:** `hapi-peer-stack up|down|status|doctor|gc`
- **Still forbid:** `hapi-use-driver`, `hapi-use-worktree`, `hapi-driver-rebuild --activate`

### `docs/tooling/README.md`

- Link to this plan + usage examples.

### `.gitignore`

- Ensure `localdocs/peer-stack.env` and `~/.hapi-peer/` documented (peer env is worktree-local; registry is home-local).

---

## Vertical slice proof (mandatory acceptance)

Replay **tiann/hapi#959** (branch `fix/scratchlist-exit-after-queue` or worktree `scratchlist-exit-after-send`). Modality: **MP4 required** (multi-step scratchlist exit after Send to queue — PNG alone would not show the sequence).

1. `hapi-peer-stack up --name scratchlist-959 --worktree ~/coding/hapi/worktrees/scratchlist-exit-after-send`
2. `bun run test:e2e:peer e2e/scratchlist-exit-after-queue-peer.spec.ts`
3. Capture PNG + MP4 under `localdocs/playwright-runs/959-peer-stack.*` (gitignored staging)
4. **HAPI web inline media:** `bun scripts/tooling/hapi-display-image.mjs <prefix> <absolute-path> [title]` on any session **with** `metadata.hapiMcpUrl` (not Cursor IDE composer). Canonical demo: Cursor session `4971055d` (#956). PNG/GIF → `display_image`; MP4/WebM → `display_video` (#956).
5. After operator approval and upstream PR: **attach the same files to the GitHub PR** (not committed to git). See intake §8.
6. `hapi-peer-stack down --name scratchlist-959`

**Pass criteria:** Operator confirms recording shows **real SessionChat chrome** (not fixture). Playwright asserts scratchlist mode exits after successful Send to queue.

---

## Implementation tasks

### Task 1: Spike — health endpoint + session create path

**Files:**

- Read: `hub/src/web/routes/sessions.ts`, `hub/src/web/server.ts`, `web/src/api/client.ts`
**Steps:**

1. Confirm hub health at `GET /health` (no new route needed).
2. Document smallest API to get a session id usable at `/sessions/:id`.
3. Note whether runner must be up for seed (drives `--no-runner` default).

**Commit:** `docs: peer stack spike notes` (in plan Live evidence section or `docs/tooling/peer-stack.md`).

---

### Task 2: Registry + port allocator library

**Files:**

- Create: `scripts/tooling/lib/peer-stack-registry.sh`
- Create: `scripts/tooling/lib/peer-stack-ports.sh`

**Behavior:**

- `peer_stack_allocate_port` → hub port in 3100–3199, skip ports in use (`ss -ltn`).
- `peer_stack_registry_write/read` JSON via `jq`.
- Idempotent `up` refuses if name already running.

**Test:** shell unit-style script invoked from `hapi-peer-stack doctor` with fake registry fixture.

**Commit:** `feat(tooling): peer stack registry and port allocation`

---

### Task 3: `hapi-peer-stack` up/down/status

**Files:**

- Create: `scripts/tooling/hapi-peer-stack.sh`
- Create: `~/.local/bin/hapi-peer-stack` symlink via existing install pattern OR document `scripts/tooling/install-hapi-cli.sh` addition

**Commands:** implement `up`, `down`, `status`, `doctor` (gc optional v1.1).

**Commit:** `feat(tooling): hapi-peer-stack lifecycle scripts`

---

### Task 4: Web build + hub start integration

**Files:**

- Modify: `scripts/tooling/hapi-peer-stack.sh` (build step)
- Verify: hub serves `web/dist` from worktree (relative path from hub cwd — check `hub/src/web/server.ts` static root)

**If hub resolves dist relative to repo root:** pass env `HAPI_WEB_DIST` only if already supported; else minimal hub change in worktree:

- Modify: `hub/src/web/server.ts` — honor `HAPI_WEB_DIST_DIR` env for peer stacks (upstreamable).

**Commit:** `feat(hub): optional HAPI_WEB_DIST_DIR for peer stack web serving` (if needed)

---

### Task 5: `seed-peer-session.mjs`

**Files:**

- Create: `scripts/dev/seed-peer-session.mjs`
- Test: `scripts/dev/seed-peer-session.test.mjs` (optional; manual JSON ok for v1)

**Commit:** `feat(scripts): seed minimal peer stack session for Playwright`

---

### Task 6: Playwright peer mode

**Files:**

- Modify: `playwright.config.ts`
- Create: `scripts/dev/run-e2e-on-peer-stack.mjs`
- Modify: root `package.json` scripts
- Create: `e2e/scratchlist-exit-after-queue-peer.spec.ts` (or parametrize existing spec with env)

**Commit:** `feat(e2e): Playwright peer stack mode for real session UI`

---

### Task 7: Handoff example + ffmpeg helper

**Files:**

- Create: `scripts/dev/scratchlist-exit-after-queue-handoff.mjs`
- Create: `scripts/dev/peer-stack-trim-video.sh` (ffmpeg one-liner from intake §6.4)

**Commit:** `feat(scripts): peer stack handoff example for scratchlist #959`

---

### Task 8: Policy docs + gitignore

**Files:**

- Modify: `docs/tooling/new-feature-intake.md`
- Modify: `docs/operator/AGENTS.md`
- Modify: `.cursor/rules/operator-fork.mdc`
- Modify: `docs/tooling/README.md`
- Modify: `.gitignore` (root or web — add `localdocs/peer-stack.env`)

**Commit:** `docs: peer stack as default feature peer demo topology`

---

### Task 9: Vertical slice evidence

**Steps:**

1. Run full acceptance on `scratchlist-exit-after-send` worktree.
2. Attach PNG + MP4-on-disk paths to plan **Live evidence** section below.
3. Post inline media to a HAPI session with `hapiMcpUrl` via `hapi-display-image.mjs` (absolute paths). Target any flavor with live MCP — e.g. Cursor `#956`, not orchestrator `503d9757` without MCP.

**Commit:** `docs: peer stack live evidence scratchlist #959`

---

### Task 10: CI smoke (optional v1.1)

**Files:**

- Modify: `.github/workflows/test.yml` — job `peer-stack-e2e` on ubuntu with `hapi-peer-stack up`, one spec, `down`

**Defer** if flaky on GitHub; local proof is sufficient for v1.

---

## Definition of done

- [x] `hapi-peer-stack up|down|status|doctor` works from a canonical worktree without touching `:3006`.
- [x] Registry prevents port collisions; `doctor` detects stale PIDs.
- [x] Playwright runs against real `/sessions/:id` on peer hub with auth injection.
- [x] #959 vertical slice produces operator-recognizable session UI recording (peer stack `:3100`; inline PNGs in HAPI web session `4971055d` / #956).
- [x] Intake + operator docs + cursor rule updated; peer stack is **default** in §5.
- [x] `bun typecheck` — cli+hub pass; web has pre-existing remark-table errors on main (unrelated).
- [x] Plan **Live evidence** section filled with commands + timestamps.

---

## Friction mode

**Steelman against default peer stack:** slower gates (~build web + hub boot), more flake (seed/session/auth), peers may leave stacks up — TTL/gc required.

**Kill criteria:**

- If `up` → healthy hub exceeds **90s** twice on operator machine, optimize (cached dist, skip `bun install`) before policy flip.
- If session seed requires live agent for most web features, v1 must include runner by default (not `--no-runner`).

**Cheapest falsification:** Task 9 only — if #959 cannot be proven on peer stack, do not merge policy doc changes.

---

## Live evidence

- **Date:** 2026-06-20T17:46Z (operator machine, Europe/London)
- **Worktree:** `~/coding/hapi/worktrees/scratchlist-exit-after-send` (branch `fix/scratchlist-exit-after-queue-send`, #959 fix)
- **Tooling worktree:** `~/coding/hapi/worktrees/peer-stack` @ `feat/hapi-peer-stack`
- **Commands:**

```bash
hapi-peer-stack up --name scratchlist-959 \
  --worktree ~/coding/hapi/worktrees/scratchlist-exit-after-send
export PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome
source ~/coding/hapi/worktrees/scratchlist-exit-after-send/localdocs/peer-stack.env
bunx playwright test e2e/scratchlist-exit-after-queue-peer.spec.ts
node scripts/dev/scratchlist-exit-after-queue-handoff.mjs
hapi-peer-stack doctor
# prod untouched: curl -sf http://127.0.0.1:3006/health → ok
```

- **Screenshot (disk):** `localdocs/playwright-runs/959-peer-stack.png`, `959-peer-stack-handoff.png`
- **Video (disk only):** `localdocs/playwright-runs/959-peer-stack.mp4` (from handoff webm trim; not inline via `display_image`)
- **HAPI inline PNGs:** posted to session `4971055d` (#956 cross-flavor inline images) — `/sessions/4971055d-508b-4a93-8673-148cb97fd33d`
- **Hub URL (peer stack):** `http://127.0.0.1:3100` (not `:3006`)
- **Playwright:** 1 passed — real SessionChat chrome; scratchlist mode exits after Send to queue; message lands in thread
- **Operator ack:** confirmed 2026-06-20 — both `generated-image` cards render in HAPI web session `4971055d` (#956); hub fetch 200 for both PNGs (55KB / 62KB)

---

## Dedicated agent handoff (copy to spawn prompt)

```markdown
## Parent
- Orchestrator session: <fill when spawning>
- Operator request: Default isolated HAPI stack for every feature peer — implement `hapi-peer-stack` per plan.

## Intake status (orchestrator completed)
- [x] 1 Code search — DONE: isolation via HAPI_HOME/HAPI_LISTEN_PORT/HAPI_API_URL; no packaged peer stack; Playwright fixture-only at :5179
- [x] 2 Upstream search — DONE: no upstream equivalent; fork tooling
- [x] 3 Playback — DONE: operator 2026-06-20
- [x] 4 Issue — spike/plan only (no tiann issue required for tooling)
- [x] 5 Demo topology — peer stack (this project IS the topology)

## Your assignment (feature peer)
- Own: **full plan** `docs/plans/2026-06-20-hapi-peer-stack-default.md` Tasks 1–9 (Task 10 optional)
- Do NOT redo: discovery / plan authorship
- Worktree: `hapi-worktree-create peer-stack --branch feat/hapi-peer-stack` off **fork `main`** (tooling + docs; hub change only if HAPI_WEB_DIST_DIR needed)
- Do NOT edit `~/coding/hapi-driver` by hand
- Do NOT run `hapi-use-driver`, `hapi-use-worktree`, `hapi-driver-rebuild --activate`
- Read: `docs/plans/2026-06-20-hapi-peer-stack-default.md`, `docs/operator/AGENTS.md`, `docs/tooling/new-feature-intake.md`
- Gates: `bun typecheck`; run vertical slice #959 on peer stack; operator confirms real UI recording
- Report: `localdocs/peer-stack.env` sample (redacted token), test output, doc diff stat, inline PNGs via `hapi-display-image.mjs` to MCP session (#956 pattern); MP4 on disk only

## Links
- Plan: docs/plans/2026-06-20-hapi-peer-stack-default.md
- Proof target: tiann/hapi#959 / worktree scratchlist-exit-after-send
```

---

## Spawn command (operator)

From orchestrator session with spawn-peer-agents skill:

- **Title:** `Peer: hapi-peer-stack default`
- **Workspace:** `~/coding/hapi` (mirror) or worktree after Task 1 creates it
- **Brief:** paste § "Dedicated agent handoff" above
- **Rename session** after spawn per skill
