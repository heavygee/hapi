# Agent Tooling — Meta Bot Charter

This directory is the **canonical contract** for repo, testing, and dev maintenance across active agents on the HAPI hub and adjacent projects on this machine.

**Meta bot** = the agent (or session) explicitly tasked with keeping this contract accurate, the machine helpers working, and feature agents from stepping on each other.

Feature agents should **read the relevant doc below at session start**; meta bot reads **all of them** and fixes drift.

---

## Scope

| Layer | What | Meta bot owns |
|-------|------|----------------|
| **HAPI API / hub** | `~/coding/hapi` (upstream/main mirror), `~/coding/hapi/driver` (daily soup), `~/coding/hapi/worktrees/*` PR worktrees, `hapi-active` symlink | Driver manifest rebuild, worktree hygiene, live swing |
| **Adjacent HAPI repos** | e.g. `hapi-garden`, `hapi-session-attention`, any `~/coding/hapi-*` worktree with an open branch | Same rules; confirm which tree is active before debugging "prod" |
| **Machine helpers** | `~/.local/bin/hapi-use-worktree`, `hapi-use-main`, `gh` wrapper, `pr-post-push-check*`, `~/.local/bin/hapi-sessions-health.sh` → `server-setup/scripts/hapi/` | Installed, executable, match docs |
| **Agent hooks** | `~/.claude/settings.json`, `~/.cursor/hooks.json`, `~/coding/AGENTS.local.md` | Policy text matches docs; note IDE vs CLI hook parity gaps |
| **Upstream boundary** | `tiann/hapi` PRs | No operator-local files; **disclose AI model** in PR body per upstream `CONTRIBUTING.md` (post-#727); see repo `AGENTS.local.md` for the `## Disclosure` template |

**Not in scope for meta bot by default:** unrelated repos with no HAPI session unless the operator assigns them.

---

## Tooling index

| Doc | Purpose |
|-----|---------|
| [`feature-work-lifecycle.md`](./feature-work-lifecycle.md) | **Sole workflow doc** — one flow: intake, peer stack, soup, proof, PRs (mermaid lives here only) |
| [../operator/feature-work-lifecycle.md](../operator/feature-work-lifecycle.md) | Stub pointer for agents reading `docs/operator/` |
| [new-feature-intake.md](./new-feature-intake.md) | **Operator requests new behavior** — discovery, playback, peer stack / soup / clean demo, gates before dogfood, PR after approval |
| [peer-stack.md](./peer-stack.md) | **Isolated peer hub** — `hapi-peer-stack up` for Playwright on real session UI without `:3006` |
| [dogfood-shot.md](./dogfood-shot.md) | **Oneshoot §6.4 proof** — `hapi-dogfood-shot` (auth + screenshot + `display_image`); do not hand-roll Playwright for SessionChat |
| `scripts/tooling/hapi-sync-fork-main.sh` | Keep `~/coding/hapi` `main` = upstream + fork docs |
| [commit-hooks.md](./commit-hooks.md) | `install-git-hooks.sh` — secrets + operator path gates |
| [git-stash-policy.md](./git-stash-policy.md) | **Multi-agent repo** - do not stash other agents' work; commit instead |
| [worktree-testing.md](./worktree-testing.md) | `hapi-active` symlink, `hapi-use-worktree`, service swing |
| [driver-soup.md](./driver-soup.md) | Daily driver manifest, merge-train PR worktrees, garden vs soup |
| [cursor-auth-fleet-sync.md](./cursor-auth-fleet-sync.md) | **Cursor Agent auth** — oos `auth.json` source of truth; sync to proxmox runner envs + pin/`chattr`; account switch |
| [cursor-hapi-mcp.md](./cursor-hapi-mcp.md) | Cursor ↔ HAPI MCP sidecar wiring (not login) |
| [operator-lock.md](./operator-lock.md) | **Portable install** — `install-hapi-operator-lock.sh` (all guards) |
| [watch-activate-driver.md](./watch-activate-driver.md) | `hapi-watch-activate-driver` - external-only watch; ouroboros guard + excludes |
| `~/coding/server-setup/config/logrotate/hapi-logs` | **Machine:** rotate `~/.hapi/logs/*.log` (CLI/runner/agent nohup hubs). Prod hub → `journalctl -u hapi-hub`. Install: `sudo cp …/hapi-logs /etc/logrotate.d/hapi-logs` |
| [pr-review-loop.md](./pr-review-loop.md) | Pre-PR verification + cold review; **full court press** (dual Cursor colds to minimize bot thrash); pre-push open-PR gate; post-push poll |
| [pr-reply.md](./pr-reply.md) | `hapi-pr-reply` — atomic reply + `resolveReviewThread` for PR review comments. Mandatory for bot/reviewer thread responses (never `gh pr comment` for that) |
| [cold-pr-review-rubric.md](./cold-pr-review-rubric.md) | Open-PR cold review bar (match upstream HAPI Bot severity) |
| `scripts/tooling/hapi-pr-create.sh` | Upstream PR gate (leak scan, fork-stage, defaults `--repo tiann/hapi`) |
| `scripts/tooling/hapi-pr-create-fork.sh` | **Fork PR gate** — defaults `--repo heavygee/hapi`; use for tooling/docs (never bare `gh pr create`) |
| `scripts/tooling/install-hapi-operator-lock.sh` | **One-shot operator lock** — all guards + local bin (see [operator-lock.md](./operator-lock.md)) |
| `scripts/tooling/verify-hapi-operator-lock.sh` | Verify lock install (`--with-sudo` on hub hosts) |
| `scripts/tooling/hapi-soup-route-mounts-check.mjs` | **Soup remat gate** — fail closed if soup-critical hub `create*Routes(` mounts missing from `server.ts` while the route module exists (upgrade/features/inbox/overseer class) |
| `scripts/tooling/install-gh-wrapper.sh` | Install `~/.local/bin/gh` wrapper — **hapi trees only**: checklist + Enter (human TTY) / `HAPI_PR_CREATE_ACK=1` (agents); blocks fork-only diffs targeting `tiann/hapi` (#971). Non-hapi repos passthrough. |
| `scripts/tooling/hapi-meta-daily.sh` | **Daily Meta PR watcher entrypoint** — discover → classify → chip status cache → strip title emoji (chipped) → policy-ping → wave-clear unlock → action queue; optional chatty contribution-state events (`--emit-events`, default off; also `--dry-run`, `--no-ping`, `--json`) |
| `scripts/tooling/lib/meta-wave.sh` | **Wave-clear helpers (gate A)** — owned 🔧 only; layer+worktree clean; 30m collect; defer on `hapi-driver-status` busy |
| `scripts/tooling/install-hapi-meta-daily-timer.sh` | **Machine-local timers** (fork-only) — **hourly** ping windows **Europe/London** + quiet `--no-ping --emit-events` every 45m **24/7**; units in `scripts/tooling/systemd/hapi-meta-daily*` |
| `scripts/tooling/hapi-pr-emoji-batch.sh` | Pure PR classifier → per-PR JSON (`--table`); shared engine |
| `scripts/tooling/hapi-pr-session-emoji.sh` | **Removed stub** — exits 2, prints successor `hapi-meta-daily.sh [--pr N]` (ADR D8; no escape hatch) |
| `scripts/tooling/lib/pr-emoji-core.sh` | Pure classify/title/ping-policy fns (unit-tested: `*.test.sh`) |
| `scripts/tooling/hapi-remote-agent-budget.sh` | Pre-flight before bulk remote agent spawns (count + mem/swap gates) |

**Operator tooling lives on fork `main` at `~/coding/hapi/scripts/tooling/`** — commit changes there. Do **not** hand-edit `~/coding/hapi/driver` (read-only soup tree; `hapi-driver-rebuild` resets it). Run the daily sweep from the mirror:

```bash
cd ~/coding/hapi && ./scripts/tooling/hapi-meta-daily.sh          # the whole dance
cd ~/coding/hapi && ./scripts/tooling/hapi-meta-daily.sh --dry-run # preview, no writes
cd ~/coding/hapi && ./scripts/tooling/hapi-meta-daily.sh --emit-events --no-ping # train Overseer inbox without interrupting peers
sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh        # oos timers (hourly pings + 24/7 quiet refresh)
```

**Scope:** `tiann/hapi` upstream PRs only. Non-HAPI sessions (YAACC, other repos) are excluded from sweeps.

Status lives on the **PR chip** (`externalRefs.status`), not the session title. Contract: **✅** open green · **🔁** CI in flight · **⚠️** fix/rebase/closed-unmerged · **📝** pre-PR · **🔧** merged · **`?`** data unavailable / **stale cache (>2h since `statusCheckedAt`)** — web never live-queries GitHub. Meta strips leading title emoji for chipped sessions. Ping policy is **state-gated**. Full detail: `docs/operator/AGENTS.md` § Meta PR watcher.

---

## Meta bot responsibilities

### 1. Worktree and live hub discipline

**Workflow:** [feature-work-lifecycle.md](./feature-work-lifecycle.md) only. This section: layout reminders for meta bot.

- Mirror `~/coding/hapi` ≠ daily driver `~/coding/hapi/driver`
- One agent → one worktree under `~/coding/hapi/worktrees/<name>`
- Manifest / rebuild mechanics: [driver-soup.md](./driver-soup.md)

### 2. PR and review hygiene

Enforce for **all** agents (IDE, Claude Code, Cursor CLI/HAPI):

1. `/verification-before-completion` before any success claim or PR.
2. `/requesting-code-review` cold diff before `gh pr create` **and before every push** to a branch with an open PR (full `origin/<base>...HEAD`; see [cold-pr-review-rubric.md](./cold-pr-review-rubric.md)).
3. After push to an open PR: unresolved thread poll (hook or manual).
4. Reply + **resolve** every addressed review thread.

**Enforcement stack (weakest → strongest):**

| Mechanism | Works in Cursor CLI/HAPI? |
|-----------|---------------------------|
| `~/coding/AGENTS.local.md` rules | Yes (if agent reads them) |
| `~/.local/bin/git` wrapper on `git push origin` (open PR) | Yes (stderr STOP reminder; non-blocking) |
| `~/.local/bin/gh` wrapper on `gh pr create` | Yes (stderr checklist + **blocks fork-only → tiann/hapi**) |
| Claude `PreToolUse` on `gh pr create` + `git push origin*` | Claude only |
| Claude `PostToolUse` post-push poll | Claude only |
| Cursor IDE `beforeShellExecution` / `postToolUse` | IDE yes; headless `agent` **often no** (probe 2026-05-26) |

When CLI hooks do not fire, meta bot runs manual fallback after push:

```bash
~/.local/bin/pr-post-push-check-core.sh "$(git branch --show-current)"
```

See [pr-review-loop.md](./pr-review-loop.md).

### 3. Session and runner health

Monitor hub-connected agents:

```bash
hapi-sessions-health.sh           # all sessions
hapi-sessions-health.sh --watch   # BBS panel, 15s refresh
hapi-sessions-health.sh jellybot  # filter by path/flavor/id
```

Meta bot triages `STUCK?`, `ZOMBIE`, and missing runner PIDs; escalates or kills stale processes per operator policy.

Script: `~/coding/server-setup/scripts/hapi/hapi-sessions-health.sh` (operator tooling; symlinked as `~/.local/bin/hapi-sessions-health.sh`). Used to live in this repo at `scripts/hapi-sessions-health.sh`; relocated 2026-05-31 so `git stash -u` operations on HAPI worktrees don't sweep it away.

### 4. Verification commands (HAPI default)

From the **active worktree** (not necessarily main):

```bash
bun typecheck          # repo root
bun run test           # cli + hub
cd web && bun run build   # before hub UI test
```

Meta bot does not merge or declare "done" without evidence from these (or the repo's documented subset for a given change).

### 5. Fork `main` sync (mandatory cadence)

```bash
hapi-sync-fork-main              # after upstream merges
hapi-sync-fork-main --check-only # before driver rebuild / intake (also enforced by hapi-driver-rebuild)
```

Push `origin main` after sync. Fork `main` must stay **upstream/main + fork-only docs** — see [driver-soup.md](./driver-soup.md).

### 6. Documentation maintenance (tooling docs)

When tooling behavior changes, meta bot updates **in the same change**:

- The relevant file under `docs/tooling/`
- Repo `AGENTS.local.md` (operator-local, never upstream)
- Machine scripts at `~/.local/bin/` if source-of-truth moved

Keep [pr-review-loop.md](./pr-review-loop.md) honest about IDE vs CLI hook support.

### 7. Worktree lifecycle

After merge:

```bash
hapi-use-main
git worktree remove ~/coding/hapi-<feature>   # or --force if needed
```

Meta bot periodically lists `git worktree list` and flags stale trees.

---

## Session-start checklist (meta bot)

```bash
readlink -f ~/coding/hapi-active
git worktree list
systemctl is-active hapi-hub.service
test -L ~/coding/hapi/hub/.env && test -L ~/coding/hapi-active/hub/.env
hapi-sessions-health.sh | head -40
```

Then read both tooling docs if anything changed since last session.

---

## Session-start checklist (feature agents)

1. Read [`docs/operator/AGENTS.md`](../operator/AGENTS.md) (fork canon). For new behavior, read [new-feature-intake.md](./new-feature-intake.md) (orchestrator handoff §0).
2. Read repo `AGENTS.local.md` (or `~/coding/AGENTS.local.md`).
3. Confirm `git branch --show-current` and `pwd` — worktree, not main checkout.
4. Skim [new-feature-intake.md](./new-feature-intake.md) for soup vs clean demo and §6 gates (tests, cold review, Playwright + visual evidence — PNG for existence, GIF/MP4 for interaction — **before** operator browser test; same media in upstream PR).
5. Skim [worktree-testing.md](./worktree-testing.md) if touching hub or systemd.
6. Skim [pr-review-loop.md](./pr-review-loop.md) before push/PR (after operator dogfood approval).

---

## Escalation to operator

Meta bot stops and asks when:

- `hapi-active` points at unknown path
- Hub won't start after swing (missing build, bad env, port conflict)
- Multiple agents in `STUCK?` on same repo
- Hook/machine drift (doc says X, system does Y)
- Upstream PR would include operator-local or secret files
