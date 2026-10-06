# Exit reflection: agent-harness-session-wake (PR #1487)

> Gate A' after Meta 🔧 ping 2026-08-11.

## Shipped as

- PR(s): [tiann/hapi#1487](https://github.com/tiann/hapi/pull/1487) (`24e0c7671`) — Cursor ACP harness wake → hub `thinking`
- Absorber (if superseded): n/a (shipped; follow-on hotfix is #1503)
- Session: `fd7dea18` (dogfood harness wake)

## Non-code residue

- #1487 correctly mapped ACP foreground intent onto keepalive thinking; Cursor also chatters `state_update` / background `tool_call*` while queue-idle → session-list spinner flicker (#1502 / PR #1503).
- First soup hotfix (`f2f36e02e`: ignore `running`, clear on `idle`) landed in driver; residual flicker on this dogfood session from tool/content bumps racing idle clears (ACP allows background updates while idle).
- Tip-forward `81af5350e` on `fix/cursor-thinking-flicker-1487` (#1503) not yet rematted — Meta remats once wave-clear; do not remat mid-wave from this peer.
- Soup layer `feat/agent-harness-session-wake` already `# DROPPED`; orphan worktree stub removed; branch gone.
- Do not conflate janus-oos sticky spinners / runner-upgrade skew with this flicker path.

## Promote?

Pick one primary (and optional second):

- [x] `lifecycle / tooling doc` — path + one-line change
  - `docs/tooling/feature-work-lifecycle.md` or PR-review notes: after ACP `state_update`→UI busy mappings, kill-criteria must include “background `tool_call*` while idle” (spec-allowed), not only `running` chatter.
- [ ] `none` — no durable follow-up
- [ ] `High-signal index` — one row for `docs/operator/AGENTS.md` (paste proposed row)
- [ ] `tooling issue` — title + why (file or link)

## Open questions / landmines

- Estate still needs #1503 remat + Cursor CLI recycle before dogfood `fd7dea18` stop flickering; Gate A for #1487 does not wait on that.
- Sticky `thinking=true` on untouched janus-oos sessions is a separate landmine (likely unrecycled CLIs / no idle clear).

## Skip

- n/a
