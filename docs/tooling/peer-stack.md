# HAPI peer stack (isolated hub + web + runner)

Agent-safe isolated stack for feature peers. Does **not** touch production `:3006` or `hapi-active`.

**Canonical home:** `~/coding/hapi` mirror `main` only. Do not duplicate this doc under nested worktrees; link here.

**Where this fits in the overall flow:** [feature-work-lifecycle.md § Three demo topologies](./feature-work-lifecycle.md#three-demo-topologies-operator-picks-at-5) — this file is commands and evidence mechanics only.

## Spike notes (Task 1, 2026-06-20)

### Health

- `GET /health` on the peer hub returns `{ status: 'ok', protocolVersion }` — no auth, no new route needed (`hub/src/web/server.ts`).

### Session seed path (chosen)

1. **Create session:** `POST /cli/sessions` with `Authorization: Bearer $CLI_API_TOKEN` and body `{ tag, metadata: { path, host, flavor } }` — `engine.getOrCreateSession()`; **runner not required** for the row.
2. **Activate session:** connect to Socket.IO namespace `/cli` with `auth: { token, sessionId }`, emit `session-alive` `{ sid, time, thinking: false, mode: 'remote' }` — mirrors `cli/src/api/apiSession.ts`. Required because `POST /api/sessions/:id/messages` uses `requireActive: true`.
3. **Web auth for Playwright:** inject `CLI_API_TOKEN` into `localStorage` key `hapi_access_token::<hubOrigin>` (same as `scripts/dev/session-view-toggles-handoff.mjs`). Web `useAuthSource` accepts access-token auth directly; JWT from `POST /api/auth` is optional.

### Runner default

- **`--no-runner` is not the default.** Most web handoff flows (Send to queue, composer) need an active session; runner is still useful for machine registration even when no live agent is spawned.
- Hub-served web: run hub from `$WORKTREE/hub` after `bun run build:web`; static root resolves to `$WORKTREE/web/dist` via `findWebappDistDir()` (`../web/dist` from hub cwd). No `HAPI_WEB_DIST_DIR` env needed in v1.

## Upstream PR worktree + fork tooling (read this)

Upstream PR branches are **`upstream/main...HEAD`** in `~/coding/hapi/worktrees/<name>`. Peer-stack **orchestration scripts are fork-only** — they live on mirror **`~/coding/hapi` `main`**, not in the upstream worktree, and **must not** be committed into the upstream PR.

**Do not** copy `playwright.config.ts` or fork scripts into the worktree. Use this split:

- **Product code (web/hub/cli/shared):** feature worktree @ `upstream/main`
- **`hapi-peer-stack`, `run-e2e-on-peer-stack.mjs`, peer `playwright.config.ts`:** mirror `~/coding/hapi` `main` only (or `~/.local/bin/hapi-peer-stack`)
- **Docs (this file, intake §6):** mirror `~/coding/hapi/docs/tooling/` — link, do not duplicate
- **Peer e2e specs:** mirror `~/coding/hapi/e2e/peer/<issue>-<slug>.spec.ts` — **fork main only**, never in upstream PR branches
- **Proof artifacts:** product worktree `localdocs/playwright-runs/` (gitignored; `HAPI_PEER_WORKTREE` points Playwright output there)
- **`localdocs/peer-stack.env`:** written into the **product worktree** by `hapi-peer-stack up --worktree`

**Canonical Playwright command** (always from mirror):

```bash
cd ~/coding/hapi
node scripts/dev/run-e2e-on-peer-stack.mjs \
  --worktree ~/coding/hapi/worktrees/<name> \
  --name <feature> \
  e2e/peer/<issue>-<slug>.spec.ts
```

That runs `hapi-peer-stack up` against the worktree, loads `localdocs/peer-stack.env` from the worktree, runs Playwright with mirror config (`HAPI_PEER_WEB_URL`), then tears down unless `--keep`.

**Prerequisites on the machine:** `~/.local/bin/hapi-peer-stack` (or mirror script on PATH), `bun`, system Chrome (`PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome` on Linux). `hapi-peer-stack doctor` from any cwd.

**Wrong (bootstrap pain — #980 had to guess):** assume `bun run test:e2e:peer` works inside an upstream-only worktree; copy `playwright.config.ts` from mirror by hand.

### Meta remat: `playwright.config.ts` conflicts (2026-07-28)

Upstream-bound product tips must **not** absorb fork soup Playwright tooling. Incident: remat conflict → driver/rerere union (peer-stack + `testIgnore`) → Meta told Peer #1215 to “absorb the union” → tip `121619f9b` wrongly shipped `scripts/dev/playwright-annotated-video.mjs` + peer-stack config onto an upstreamable branch (reverted as `e191f101c`).

| Surface | Owns |
|---|---|
| **Product tip** (`upstream/main` ancestry) | Optional `testIgnore: ['**/peer/**']` only — keep config upstream-simple |
| **Soup / mirror `main`** | Peer-stack (`HAPI_PEER_WEB_URL`, timeouts, annotated-video import, conditional `webServer`) |
| **Peer e2e video** | Dynamic import via `HAPI_MIRROR` / `run-e2e-on-peer-stack.mjs` from mirror — **no** helper file on the tip |

**When remat conflicts on `playwright.config.ts`:** keep the **soup/fork** peer-stack file as the driver result; cherry-pick only product-relevant tip deltas (e.g. `testIgnore`). Resolve in driver/rerere. **Do not** ask the product peer to own the full soup config or commit `scripts/dev/*` fork imports.

---

## Usage

```bash
# 1) Product work happens in the feature worktree (upstream/main)
# 2) Peer stack targets that worktree — CLI from PATH or mirror

hapi-peer-stack up --name scratchlist-959 \
  --worktree ~/coding/hapi/worktrees/scratchlist-exit-after-send

# 3) Playwright — from mirror (see § Upstream PR worktree above)
cd ~/coding/hapi
node scripts/dev/run-e2e-on-peer-stack.mjs \
  --worktree ~/coding/hapi/worktrees/scratchlist-exit-after-send \
  --name scratchlist-959 \
  e2e/peer/959-scratchlist-exit-after-queue.spec.ts

hapi-peer-stack status --name scratchlist-959
hapi-peer-stack doctor
hapi-peer-stack down --name scratchlist-959
```

**Fork-only / mirror `main` work:** `bun run test:e2e:peer e2e/peer/...` from `~/coding/hapi` (all peer specs live under `e2e/peer/`).

Env file written to `localdocs/peer-stack.env` (gitignored). Registry: `~/.hapi-peer/registry.json`.

See plan: `docs/plans/2026-06-20-hapi-peer-stack-default.md`.

## Evidence modality — agent decides PNG vs MP4

Every feature peer **assesses the task at handoff time** (before peer-stack capture) and records the choice in the handoff message. No separate UXQA spawn — the implementing agent owns the call. Goal: any agent with peer-stack tooling can reliably produce the minimum proof that shows the work.

**Choose PNG when** a still frame is enough:

- Final UI state is the proof (layout, copy, icon, badge, error string, settings value).
- Before/after is at most two frames (e.g. toggle off → on).
- No meaningful motion, timing, or multi-step choreography.
- Change is non-web (CLI, hub API, config) and handoff uses logs or API output instead.

**Choose MP4 when** motion or sequence matters:

- Multi-step flow (open panel → edit → submit → thread updates).
- Animations, transitions, scroll, lazy load, or drag.
- Timing-dependent behavior (debounce, toast, SSE/live update, spinner → done).
- "Exit mode after success" or composer/session chrome behavior.
- Anything where a single screenshot would leave the operator guessing *how* you got there.

**When unsure on web UX:** prefer MP4 (or PNG keyframe **plus** MP4). State the rationale in one line in the handoff.

Capture paths (always under gitignored `localdocs/playwright-runs/`):

- PNG — **`hapi-dogfood-shot`** (preferred oneshot for SessionChat / file viewer on `:3006` or peer; see [`dogfood-shot.md`](./dogfood-shot.md)) or a feature Playwright spec / handoff `--screenshot`.
- MP4 — Playwright `recordVideo` → `scripts/dev/peer-stack-trim-video.sh`.

Post the chosen artifact(s) **inline in HAPI web** (below) before operator dogfood. After upstream PR opens, attach the **same files to the GitHub PR** (description or comment upload) — **not** `git add`. GitHub hosts the bytes; the repo stays lean.

**Do not** invent hub auth / `networkidle` / virtualized-scroll Playwright from scratch for a static chat shot — that scavenger hunt is exactly what `hapi-dogfood-shot` exists to end.

## Inline evidence (PNG / motion)

**Cursor IDE chat does not render agent `Read()` or markdown images for this operator** — do not use as acceptance path.

### HAPI web session chat (canonical — tiann/hapi#956)

`bun scripts/tooling/hapi-display-image.mjs <session-prefix> <absolute-path> [title]`

Requirements:

1. **`cli` deps installed** — script resolves `@modelcontextprotocol/sdk` from `cli/node_modules`.
2. **Target session must have `metadata.hapiMcpUrl`** — happy MCP (`startHappyServer`) running in that session's CLI. Flavor-agnostic: **#956 is Cursor** with a live bridge; orchestrator session `503d9757` is also Cursor but **lacks** `hapiMcpUrl`. Check per-session GET, do not assume flavor.
3. **Absolute paths only** — MCP runs in the target session CLI cwd; repo-relative paths ENOENT.
4. **List endpoint omits metadata** — script falls back to `GET /api/sessions/:id` for `hapiMcpUrl` (PR #958 pattern).

### MP4 / WebM

- **Disk artifact:** `localdocs/playwright-runs/*.mp4` via `scripts/dev/peer-stack-trim-video.sh`
- **HAPI inline motion:** convert to GIF (`ffmpeg -i clip.mp4 -vf 'fps=8,scale=640:-1' clip.gif`), then `hapi-display-image.mjs` on the GIF
- **HAPI inline MP4/WebM:** `display_video` MCP (same `#956` pipeline as PNG) — `bun scripts/tooling/hapi-display-image.mjs` auto-picks video for mp4/webm
- **HAPI inline motion (legacy):** GIF via `display_image` if CLI lacks `display_video`
- **Cursor IDE:** no inline media — do not promise

Example after peer-stack proof (MCP session — canonical: Cursor `#956`):

```bash
bun scripts/tooling/hapi-display-image.mjs 4971055d \
  "$(pwd)/localdocs/playwright-runs/959-peer-stack.png" \
  "Peer stack #959 - real SessionChat"
```

