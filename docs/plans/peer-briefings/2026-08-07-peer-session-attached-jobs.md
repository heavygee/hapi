# Peer briefing: session-attached long-running jobs (capability + first dogfood)

**Spawned:** 2026-08-07  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-attached-jobs`  
**Branch:** `feat/session-attached-jobs` (from `upstream/main`)  
**First consumer session:** [Music library cleanup (Lidarr)](/sessions/ec8d1d4e-63aa-45d2-83eb-78b5b776514b) (`ec8d1d4e-63aa-45d2-83eb-78b5b776514b`)

## Problem (operator-corrected)

Not "agent is thinking." Affordances for that already exist (spinner, todos, in-progress).

The hole: an agent **spawns work that outlives the agent** - script/batch/systemd/nohup running for hours–days while the HAPI session is idle/`active: false`. Sidebar is silent. Operator must re-open chat and ask "how's it doing?"; agent `pgrep`s and narrates.

Canonical example: Lidarr/beets batch under that session - days-long drain, agent offline, real fraction available (~tracks left / ~91%) only when poked.

## What you build

**Capability:** session-attached **jobs** (name TBD) that:

1. Can be **registered / updated / cleared** against a session while the agent process is not running (hub-persisted).
2. Surface on the **session list / session chrome** so inbox glance shows "something this session owns is still running" + honest progress when known.
3. Are **opt-in / explicit** - not PID inference theater. Registration-first (API + small CLI or agent-callable path).

**Visual design is yours to figure out** (conversation / reveal / review with operator). Orchestrator stance, not a mandate:

- Prefer honest fraction / remaining count when reported; indeterminate + elapsed when only heartbeat.
- Do not fake % for opaque processes.
- Keep row density sane (gate on active jobs only).

Propose 1–2 concrete UI options with a PNG mock or live soup shot before locking chrome. Operator dogfoods before upstream PR.

## After capability exists (mandatory handoff)

Do **not** stop at "API merged to worktree." You must:

1. Soup-promote / peer-stack so `:3006` (or peer stack) can show the UI.
2. **`hapi-ping-peer` the Lidarr session** (`ec8d1d4e…`) with a clear brief: the capability exists, how to register/update their beets (or wrapper) job, what fields to send (label, done/total or remaining, heartbeat).
3. That **Lidarr agent** attaches the running work itself so the session row becomes visibly truthful without waking Codex for status.

You invent the attach instructions; they invent/operate the progress emission for their script.

## Out of scope

- Replacing thinking/todo/in-progress affordances
- Hub auto-discovering random PIDs across the estate
- Competing with #1115 session pin (different feature)

## Suggested shape (starting point, not locked)

- Hub: store job(s) on session (or small `session_jobs` table) + REST mutate + SSE/summary field
- CLI/helper: `hapi job …` or MCP tool so agents/scripts can update without JWT archaeology
- Web: session row + maybe header chip/bar driven by summary

File upstream issue early with the problem statement (Lidarr cite). Implement on this branch. **No upstream PR until operator OK after dogfood** (including Lidarr self-attach visible on list).

## Intake ownership

| Step | Status |
|------|--------|
| Problem framing | DONE |
| Upstream issue | **YOU** |
| Design reveal (visual options) | **YOU** |
| Implement capability | **YOU** |
| Soup/peer dogfood | **YOU** |
| Ping Lidarr agent to self-attach | **YOU** |
| Upstream PR | **YOU** only after operator OK |

Hard rules: product edits only in this worktree; never merge `tiann/hapi`; no agent stack-switch from tool shells.
