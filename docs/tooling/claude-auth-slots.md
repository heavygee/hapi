# Claude auth slots (primary / secondary / ultra / …)

**Fork-local ops.** Multiple Claude subscriptions with independent usage clocks. Keep oos + proxmox runners and live session processes on the same slot.

Cursor twin doc: [`cursor-auth-fleet-sync.md`](./cursor-auth-fleet-sync.md).

## Topology

| Host | How Claude OAuth reaches the runner |
|------|-------------------------------------|
| **oos-linux** | `hapi-runner-oos.service` → `EnvironmentFile=-/etc/hapi/claude-setup-token.env` (drop-in last-wins) + interactive `~/.claude/.credentials.json` |
| **proxmox** | `~/.config/claude/oauth.env` → runner env `CLAUDE_CODE_OAUTH_TOKEN` |

Slot storage (never committed):

```
~/.hapi/claude-auth/active
~/.hapi/claude-auth/<slot>/claude-setup-token.env
~/.hapi/claude-auth/<slot>/.credentials.json
```

Installed slots today: `primary` / `secondary` (Teams Max 5×), plus optional `ultra` (personal Ultra — ingest via `hapi-claude-slot-ingest`).

## Tooling (Cursor-shaped)

| Job | Command |
|-----|---------|
| Check quota / reset time | `hapi-claude-usage` / `hapi-claude-usage ultra` / `--json` |
| Ingest a new account into a slot | `hapi-claude-slot-ingest ultra` |
| Switch fleet slot (oos + proxmox runners) | `hapi-claude-account-toggle <slot>` |
| Host files + runner env match active slot? | `hapi-claude-auth-audit` |
| Live session process tokens match? | `hapi-claude-session-assess` |
| Kill+archive+reopen drifted sessions | `hapi-claude-reopen-mismatch` (thinking-only continue-wake after) |
| Continue-only wake after cutover | `hapi-claude-continue-fleet` (default: thinking-only) |

Install/refresh PATH symlinks: `bash scripts/tooling/install-hapi-local-bin.sh`

## Operator playbook — “we've run out of usage”

```bash
hapi-claude-usage                    # see which slot still works / reset clock
hapi-claude-account-toggle secondary # or primary / ultra
hapi-claude-auth-audit               # host/runner sha12 must match
hapi-claude-session-assess           # expect NEEDS REOPEN until next step
hapi-claude-reopen-mismatch          # respawn + thinking-only continue-wake
hapi-claude-session-assess           # should be clean
```

Do **not** hand-roll JWT/archive/reopen Python each time — that is what these scripts are for.

## Adding a personal Ultra slot (third account)

Teams Max slots (`primary`/`secondary`) and personal Ultra are different subscriptions — capture Ultra under an **isolated** Claude config so you do not overwrite the Teams interactive login.

```bash
hapi-claude-slot-ingest ultra
# follow the printed steps:
#   export CLAUDE_CONFIG_DIR=~/.hapi/claude-auth/ultra/capture-config
#   claude /login          # browser → personal Ultra
#   claude setup-token     # copy sk-ant-oat01-… into capture-config/claude-setup-token.env
hapi-claude-slot-ingest ultra --from-dir ~/.hapi/claude-auth/ultra/capture-config
hapi-claude-usage ultra
hapi-claude-account-toggle ultra   # when you want the fleet on it
```

Never paste the token into chat. `setup-token` output goes only into the env file (mode 600).

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

**Never continue `lifecycleState=archived`.** Soft archive drops the seat without always killing the process; continuing it re-reports finished work. Continue messages are tagged `[hapi-claude-continue-fleet]` so recipients can verify the source.

## Why reopen is separate

Toggle restarts runners so **new** spawns inherit the slot. Already-running Claude children keep the old `CLAUDE_CODE_OAUTH_TOKEN` in their process environ. Same rule as Cursor after `hapi-cursor-account-toggle` → `hapi-cursor-session-assess` → kill/reopen.
