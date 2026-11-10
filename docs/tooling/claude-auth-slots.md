# Claude auth slots (primary ↔ secondary)

**Fork-local ops.** Dual Claude Max accounts with independent usage clocks. Keep oos + proxmox runners and live session processes on the same slot.

Cursor twin doc: [`cursor-auth-fleet-sync.md`](./cursor-auth-fleet-sync.md).

## Topology

| Host | How Claude OAuth reaches the runner |
|------|-------------------------------------|
| **oos-linux** | `hapi-runner-oos.service` → `EnvironmentFile=-/etc/hapi/claude-setup-token.env` (drop-in last-wins) + interactive `~/.claude/.credentials.json` |
| **proxmox** | `~/.config/claude/oauth.env` → runner env `CLAUDE_CODE_OAUTH_TOKEN` |

Slot storage (never committed):

```
~/.hapi/claude-auth/active
~/.hapi/claude-auth/{primary,secondary}/claude-setup-token.env
~/.hapi/claude-auth/{primary,secondary}/.credentials.json
```

## Tooling (Cursor-shaped)

| Job | Command |
|-----|---------|
| Check quota / reset time | `hapi-claude-usage` / `hapi-claude-usage secondary` / `--json` |
| Switch fleet slot (oos + proxmox runners) | `hapi-claude-account-toggle primary\|secondary` |
| Host files + runner env match active slot? | `hapi-claude-auth-audit` |
| Live session process tokens match? | `hapi-claude-session-assess` |
| Kill+archive+reopen drifted sessions | `hapi-claude-reopen-mismatch` (selective continue-wake after) |
| Continue-only wake after cutover | `hapi-claude-continue-fleet` (default: interrupted/attention only) |

Install/refresh PATH symlinks: `bash scripts/tooling/install-hapi-local-bin.sh`

## Operator playbook — “we've run out of usage”

```bash
hapi-claude-usage                    # see which slot still works / reset clock
hapi-claude-account-toggle secondary # or primary — fleet runners + active marker
hapi-claude-auth-audit               # host/runner sha12 must match
hapi-claude-session-assess           # expect NEEDS REOPEN until next step
hapi-claude-reopen-mismatch          # respawn + selective continue-wake
hapi-claude-session-assess           # should be clean
```

Do **not** hand-roll JWT/archive/reopen Python each time — that is what these scripts are for.

## Does cutover stop agents mid-flow?

**Yes.** Live Claude children are killed so they can respawn on the new token. Reopen alone leaves them idle on the good account.

**Default wake is thinking-only.** Broader heuristics (lastNotify attention, usage-limit transcript text) produced fleets of “nothing to resume / nothing new” replies — operator veto 2026-11-10. Before kill, snapshot `thinking=true` only.

| Mode | Wake when |
|------|-----------|
| `thinking` (default) | `thinking=true` at pre-kill |
| `attention` (`--continue-attention`) | + lastNotify blocked/needs_*/failed/stalled |
| `aggressive` | legacy; avoid |
| `--continue-all` | every migrated session |
| `--no-continue` | auth migrate only |

Inspect: `hapi-claude-continue-fleet --classify-only`. Opt out: `~/.hapi/claude-auth/wake-skip`.

## Why reopen is separate

Toggle restarts runners so **new** spawns inherit the slot. Already-running Claude children keep the old `CLAUDE_CODE_OAUTH_TOKEN` in their process environ. Same rule as Cursor after `hapi-cursor-account-toggle` → `hapi-cursor-session-assess` → kill/reopen.
