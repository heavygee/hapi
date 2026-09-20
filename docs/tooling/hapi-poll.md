# hapi poll — declarative bare pollers

**Canon:** [scheduled-agent-tasks design](../plans/2026-09-18-scheduled-agent-tasks-design.md)

Standing rule: **no agent turns for mechanical polling.** Recurring judgment-free checks belong in a bare systemd timer + probe script, not `CronCreate` / HAPI `scheduledAt` / Cursor `/loop`.

## Taxonomy (three lanes)

| Lane | Mechanism | When |
|------|-----------|------|
| **Mechanical** | `hapi poll` → systemd timer → bare script | Diff / watermark / inbox / issue list — zero tokens on quiet ticks |
| **Judgment (session)** | Claude `CronCreate` / `ScheduleWakeup` | Bounded mid-task one-shots inside a live session (~7d, dies with session) |
| **Judgment (hub)** | HAPI `scheduledAt` user message | Wake this session with text at T |
| **Not a scheduler** | `hapi job` / `session_job` | Progress meter only |

Do **not** replace `hapi-meta-daily` with a watch — that is judgment-gated PR classify.

## CLI

```bash
hapi poll list
hapi poll validate [name]
hapi poll install <name> [--force] [--run-now] [--dry-run]
hapi poll uninstall <name>
hapi poll run <name>          # one-shot tick (flock + probe)
hapi poll doctor [name]
hapi poll templates
```

`hapi poll` is intercepted by `hapi-from-active` (fork PATH). Equivalent: `hapi-poll` / `scripts/tooling/hapi-poll.sh`.

## Registry

`config/polls.yaml` — estate-specific paths live in **entries**, not in the tool.

v1 seeded polls:

| Poll | Probe | Strategy | Action (in probe) |
|------|-------|----------|-------------------|
| `overseer-inbox` | `hapi-overseer-watch-tick.sh` | max-id | ntfy |
| `producer-issue-poll` | lockhouse-janus `poll-producer-issues.sh` | seen-set | spawn-peer |

## Install / migrate

1. `hapi poll validate overseer-inbox`
2. `sudo hapi poll install overseer-inbox --run-now`  
   Installs `hapi-poll-overseer-inbox.{service,timer}` **alongside** the legacy `hapi-overseer-watch.*` units (belt-and-braces). Both share the same watermark + flock path.
3. `hapi poll doctor overseer-inbox` — expect HEALTHY; journal should show the existing tick script.
4. After equivalence is proven, disable the legacy timer:
   `sudo bash scripts/tooling/install-hapi-overseer-watch-timer.sh --disable`

v1 is **per-host**. Registry `host:` is an install guard (`--force` to override). Remote multi-host orchestration is deferred.

## Watermark helpers

`scripts/tooling/lib/hapi-poll-watermark.sh`:

- `max-id` — `{lastMaxId}` (overseer)
- `seen-set` — one id per line (producer poll)
- `timestamp-ids` — `{last_seen_timestamp, last_seen_ids}` (PAT poller shape)

## Templates

`scripts/tooling/poll-templates/`:

- `inbox-ntfy.yaml`
- `issue-spawn.yaml`
- `issue-triage-spawn.md` (security boilerplate for spawn messages)

## Out of scope (v1)

Hub DB table, GHA probe type, web UI, declarative `query`/`filter`, `until:` self-disable, remote install.
