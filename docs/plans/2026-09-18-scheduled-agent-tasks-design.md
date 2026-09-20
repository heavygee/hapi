# Scheduled agent tasks — investigation & design (fork-only)

**Status:** design signed off; v1 as **`hapi tick`** (renamed from working title `hapi tick` to avoid collision with the HAPI Wear/watch app and hapi-monitor). See `docs/tooling/hapi-tick.md`, issue #153.  
**Date:** 2026-09-18  
**Parent remit:** [Overseer stand-in](/sessions/44f6aed0-b86d-4d26-916c-12c2c9ee2af8)

---

## Recommendation (read this first)

**Codify the estate’s existing “bare poller” pattern as a first-class HAPI affordance — do not add a new hub cron or agent-scheduler.**

Name it **`hapi tick`** (product name). It is a **declarative registry + code generator** for the pattern already proven in `hapi-overseer-watch-tick.sh`, `poll-producer-issues.sh`, and `poll-hapi-exec-gc-issues.sh`:

1. **systemd timer** fires on cadence (host-local, durable).
2. **Bare probe script** (bash/python, zero LLM) queries an external source.
3. **Watermark / seen-set** in `~/.local/state/…` prevents re-alerting every tick.
4. **Action on change only:** `ntfy`, `hapi spawn-peer`, `hapi ping-peer`, or combinations.

Judgment work that genuinely needs an LLM every tick stays in a separate lane (`CronCreate` / HAPI `scheduledAt` messages / `/loop`) and must be **opt-in**, never the default template.

The piece worth making first-class is not “scheduling” alone — it is the **escalation boundary**: cheap non-LLM detection → `spawn-peer` / `ping-peer` / `ntfy` only when there is a signal ([Antevorta setup](/sessions/32fa0937-a84c-4090-b54c-c82a5fceabe2)). Primary template for that shape: **trailer-job inbox watch** ([OpenACP polls deploy](/sessions/c88c8925-1276-4ba3-9ba4-eb72fcacc7c8) shape **A**).

**Strongest objection:** a registry in the HAPI repo does not magically place timers on janus/proxmox/oos — v1 still needs a per-host install step (`hapi tick install --host oos-linux`), and without that the capability looks “first-class” in docs but remains hand-rolled on each machine. Mitigation: v1 ships with one canonical installer path and documents host placement explicitly; defer remote orchestration to v2.

---

## The confusion (answered)

Three mechanisms are **not interchangeable**. The operator’s Lockhouse Claude was right to be confused — product docs do not surface this taxonomy.

| Mechanism | What it is | Token cost per tick | Durable? | Right for mechanical poll? |
|---|---|---|---|---|
| **`/schedule` (Claude cloud routines)** | Anthropic cloud scheduled agents; needs Claude Code **Remote Control** pairing | Full agent turn | Cloud-side | **No** — unusable on this estate (`PushNotification` already proved Remote Control inactive; same pairing gap) |
| **`CronCreate` / `ScheduleWakeup`** | **Claude Code session tools** (not HAPI hub APIs) | Full agent turn | **No** — session-scoped, ~7-day expiry, dies when session ends | **No** — overseer watch-loop burned tokens until moved to systemd (2026-08-14) |
| **HAPI `scheduledAt` user messages** | Hub queues a future user message; runner delivers when due | Agent turn **when message matures** | Yes (hub DB, ≤7 days) | **No** for probe-only checks — it always wakes the agent |
| **Cursor `/loop`** | Recurring agent prompt (local sleep loop or cloud subscription timer) | Full agent turn each tick | Session/cloud subscription | **No** for mechanical checks |
| **`session_job` / `hapi job`** | Progress meter on a session list | None (display only) | While job row exists | **No** — not a scheduler |
| **systemd timer + bare script** | Estate standard | **Zero** on quiet ticks | Yes | **Yes — default** |

**Standing rule (encode, do not relitigate):** *No agent turns for mechanical polling. Recurring judgment-free checks belong in a bare cron/systemd script, not `CronCreate`.*

### The boundary that actually matters: durability, not frequency

Peer evidence ([Antevorta setup](/sessions/32fa0937-a84c-4090-b54c-c82a5fceabe2)): `CronCreate` jobs are **structurally session-scoped** — they live only in the Claude session that created them, die when that session ends, and hard-expire at 7 days regardless of cadence. That is not tunable.

| Question | Answer | Mechanism |
|---|---|---|
| Must this outlive the conversation / survive reboot / be a standing estate capability? | **Yes** | systemd timer (+ bare script) — this is what “first-class” means here |
| Bounded to work actively in progress in *this* session? | **Yes** | `CronCreate` one-shot — e.g. AppArmor complain→enforce “check back in ~40min when lease renews” |

Concrete Antevorta session: **two `CronCreate` one-shots** (AppArmor follow-up) + **one systemd timer** (`hapi-producer-issue-poll.timer`, 20min, bare `gh`+python, `spawn-peer` only on new issues). Same session, correct split.

### The cost boundary: separate detection from response

Token cost must scale with **actual work**, not polling frequency. Producer poll at 20min = 72 ticks/day; bare script cost ≈ zero; agent tokens only on rare new-issue ticks. A `CronCreate` prompt “check and triage issues” every 20min = **72 full LLM turns/day** mostly saying “nothing new” — backwards economics. Overseer watch-loop made the same mistake before `hapi-overseer-watch-tick.sh` (header comment is estate canon).

### Middle case (v1.5 — decide at sign-off)

**Recurring but session-bounded until a condition:** e.g. “check this PR’s CI every 5min until green, then stop.” Neither mechanism self-terminates cleanly today:

- `CronCreate` → manual `CronDelete` when done.
- systemd timer → explicit exit-condition / self-disable in script, or operator `hapi tick uninstall`.

**Proposal:** v1 documents the gap; v1.5 adds `until:` / `max_ticks` / `exit_when` on watch spec, or a **`hapi tick run --until <expr>`** wrapper for session-scoped babysits (still durable unit, but probe script calls `systemctl disable` on success). Do not conflate this with mechanical standing pollers.

---

## Does a first-class path already exist?

**Partially — as a repeated pattern, not as one discoverable product surface.**

### Closest canonical implementation (HAPI tree)

`scripts/tooling/hapi-overseer-watch-tick.sh` + `install-hapi-overseer-watch-timer.sh`:

- Cadence: systemd `OnCalendar=*:8,38` (30 min).
- Probe: `hapi-overseer-call.sh tool query_inbox`.
- Watermark: `~/.local/state/hapi/overseer-watch-watermark.json` (`lastMaxId`, advance with `max(current,new)`, never regress).
- Action on change: `ntfy` via `hapi-overseer-call.sh ntfy` (not HAPI push, not agent).
- Explicitly **replaced** a `CronCreate` prototype that re-invoked Claude every tick (`docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md`).

### Live estate pollers (cross-checked)

| Poller | Cadence | State / dedup | Agent wake | Notes |
|---|---|---|---|---|
| **Overseer inbox watch** | systemd 30m | `lastMaxId` JSON | ntfy only | Zero tokens on quiet tick |
| **Producer issue poll** (`lockhouse-janus`) | systemd 20m | `~/.cache/producer-issue-poll-seen.txt` (issue numbers) | `hapi spawn-peer` per new issue | Mechanical poll; agent only on new work |
| **Hapi-exec-gc poll** (`lockhouse`) | systemd (same pattern) | `~/.cache/hapi-exec-gc-poll-seen.txt` (`repo#num`) | `hapi spawn-peer` | PR-only policy in spawn message |
| **PAT mint alerts** (`lockhouse/setup`) | GitHub Actions 20m | `state/pat-mint-alerts.json` (`last_seen_timestamp` + `last_seen_ids`) | ntfy (+ optional Teams) | No agent; fails closed if ntfy publish fails (no watermark advance) |
| **Movie night pipeline** (`server-setup`) | Multiple systemd timers (Wed–Fri calendar) | `~/.local/state/movie-night/current-week.json` | ntfy / HAL voice on gate failure | Calendar automation, not issue polling |
| **Trailer-job inbox watch** ([OpenACP polls deploy](/sessions/c88c8925-1276-4ba3-9ba4-eb72fcacc7c8) **A**) | user systemd loop, 20s (`TRAILER_WATCH_INTERVAL_SEC`, floor 5s) | `~/.cache/videoagent/trailer-job-watch-state.json` (notified id set) | `hapi ping-peer` → videoagent factory session | SSH-list proxmox inbox; drop ids that left inbox so re-queue can re-ping; OpenACP writes inbox, oos polls — **best HAPI wake template** |
| **OpenACP Poll-ACP** (shape **B**) | **Discord events** (no cadence) | `/workspace/.openacp/` session store | discord-adapter → Cursor in container | Not a poller; reactions do not wake; adjacent 60s watchdog is stall-detection only |
| **Movie night timers** (shape **C**) | calendar systemd (Wed–Fri) | `~/.local/state/movie-night/current-week.json` | ntfy / voice; **no HAPI wake** | Legacy/automated path; can race with OpenACP human approve |
| **Meta PR daily** (`hapi-meta-daily.timer`) | systemd hourly | `meta-daily.json` fingerprints | `hapi ping-peer` to Meta session | Hybrid: deterministic classify + **judgment-gated** peer ping |

### Three production shapes around movie/OpenACP (peer taxonomy)

Do **not** model the HAPI abstraction on OpenACP Discord (events) or calendar timers (one-shot jobs). Model it on **shape A**:

```
Writer (OpenACP / API) → watermarked resource (inbox/, issue list, API cursor)
Poller (oos, bare loop/timer) → diff vs notified-set → ping-peer | spawn-peer | ntfy
```

**Shape A — trailer-job inbox watch** (`videoagent-trailer-job-watch.service`, oos-linux): continuous loop; SSH `BatchMode` list `proxmox:…/trailer-jobs/inbox/*.json`; notified-id set with re-queue semantics; `hapi ping-peer $TRAILER_FACTORY_SESSION`. Fragile: SSH to proxmox, hardcoded factory session id in unit env, dual-host inbox (proxmox write / oos poll), emoji does not wake.

**Shape B — OpenACP Poll-ACP:** event-driven intake; watchdog shadow mode (`promptRunning && lastActiveAt` stale >600s). Fragile: env whitelist stripping, agent confabulation, Message Content Intent.

**Shape C — movie-polls-*.timer:** calendar automation as HeavyGee user; coordinates with OpenACP via skip markers; dual ownership race risk.

### Peer consult highlights (full)

- **[Antevorta setup](/sessions/32fa0937-a84c-4090-b54c-c82a5fceabe2):** Durability > frequency. `CronCreate` = bounded mid-task one-shots only. Standing poller = `hapi-producer-issue-poll.timer` (installed same session). Wants from a built-in: durable default, declarative query+filter (not hand-written bash each time), `spawn-peer` escalation baked in, real CLI verb not hand systemd. Flagged middle case (CI babysit until green).
- **[OpenACP polls deploy](/sessions/c88c8925-1276-4ba3-9ba4-eb72fcacc7c8):** Shape A for HAPI abstraction; OpenACP is writer not poller.
- **[PAT-mint alerting](/sessions/c4a3f9d3-b376-4c13-a758-e794bd3b434c)** (archived; transcript): watermark = timestamp + document-id set at max timestamp; alert only on `access_granted`; state not advanced on partial ntfy failure.
- **[poller-mechanism-test](/sessions/568543df-d0d9-4cba-908f-baf9ff5d068a):** Validated producer-issue-poll install path on `lockhouse-janus` (systemd + `flock` + spawn-peer).

**Conclusion for design Q1:** The capability is **real but undiscoverable** — deliverable is **surfacing + scaffolding**, not a greenfield hub scheduler.

---

## The unit of work

A **Watch** (or **Poller**) is a declarative record:

```yaml
name: producer-issue-poll          # stable id → systemd unit prefix
host: oos-linux                    # where the timer runs (registry metadata; install is host-local)
cadence: "OnCalendar=*:3,23,43"    # systemd timer | loop interval (e.g. 20s for inbox watch)
probe:
  type: shell                      # v1: shell; v1.5: declarative gh/api/filesystem query + filter
  script: /work/coding/lockhouse-janus/scripts/poll-producer-issues.sh
  # v1.5 declarative sketch (replaces hand-written bash+python per poller):
  # query: { kind: gh_issues, repo: lhs.ghe.com/lockhouse/producer, state: open }
  # filter: "author.login != 'gc' && !author.is_bot"
state:
  path: ~/.cache/producer-issue-poll-seen.txt
  strategy: seen-set               # enum: max-id | seen-set | notified-ids | timestamp-ids
on_change:
  - spawn_peer:                    # standard escalation path (Antevorta ask)
      dir: /work/coding/lockhouse-janus
      name_template: "issue-triage-#{number}"
      agent: claude
      message_template: file://templates/issue-triage-spawn.md
  - ntfy: { topic: hapi-overseer, priority: 4 }   # optional human lane
lock: flock                        # optional; path derived from name
# until: { expr: "no_new_items_for 24h" }          # v1.5 middle case
```

**Trailer inbox example (shape A):**

```yaml
name: trailer-job-inbox
host: oos-linux
cadence: { type: loop, interval_sec: 20, min_interval_sec: 5 }
unit: { kind: user, service: videoagent-trailer-job-watch }  # migrate existing name
probe:
  type: remote_list                # SSH list glob; v1 wraps existing script
  source: proxmox:/path/to/trailer-jobs/inbox/*.json
state:
  path: ~/.cache/videoagent/trailer-job-watch-state.json
  strategy: notified-ids           # drop id when file leaves inbox (re-queue can re-ping)
on_change:
  - ping_peer:
      session: $TRAILER_FACTORY_SESSION   # or resolve: "videoagent factory"
      message_template: "New job in inbox: {id}"
```

**Probe** returns exit 0 always on success (including “nothing new”); non-zero only on infrastructure failure (so systemd can alert).

**Change detection** stays in the probe script in v1 (no hub-side diff engine). The registry documents `state.strategy` so operators know how to reset/replay.

**Actions** are side effects, not probes:

| Action | Wakes agent? | Cost |
|---|---|---|
| `ntfy` | No (human) | HTTP only |
| `spawn_peer` | Yes (new session) | Tokens when peer runs |
| `ping_peer` | Yes (existing session) | Tokens when peer runs |
| `none` | No | Log/metrics only |

---

## Where it should live

| Option | Verdict |
|---|---|
| Hub-owned cron registry | **Reject v1** — couples scheduling to hub uptime; cross-host placement awkward; duplicates systemd |
| `CronCreate` in product CLI | **Reject** — wrong cost model; not durable |
| **`hapi tick` subcommand + repo-local YAML registry** | **Accept v1** — matches how `hapi-meta-daily` and overseer timers already work |
| Generated systemd units per watch | **Accept** — same as `install-hapi-overseer-watch-timer.sh` |

**Registry location (proposal):** `config/ticks.yaml` (fork-only, git-tracked definitions) + generated units under `scripts/tooling/systemd/ticks/` (or co-located in each repo for repo-specific pollers like lockhouse-janus).

**CLI surface (proposal):**

```bash
hapi tick list
hapi tick validate <name>          # lint probe exists, state path writable, no forbidden patterns
hapi tick install <name> [--host]  # sudo: install/enable timer on THIS machine
hapi tick uninstall <name>
hapi tick run <name>               # one-shot tick (operator/debug)
hapi tick doctor                   # timers enabled? last journal? watermark age?
```

`hapi tick new` (interactive scaffold) is v1.1 — v1 can ship templates copied from overseer + producer poll.

---

## Creating a watch without hand-writing systemd

1. Copy nearest template from `hapi tick templates` (overseer-ntfy, issue-spawn, api-watermark).
2. Edit `config/ticks.yaml` entry (or repo-local `ticks.yaml` symlinked).
3. `hapi tick validate foo && sudo hapi tick install foo`.
4. `journalctl -u hapi-tick-foo` + `hapi tick doctor`.

Installer generates `hapi-tick-<name>.{service,timer}` with:

- `Type=oneshot`, `User=heavygee`, `flock` guard,
- `PATH` pinning `~/.local/bin/hapi`,
- `ConditionPathExists` on probe script,
- `Documentation=file://…` backlink to registry entry.

---

## Enforcing the token-cost distinction (not just documenting)

1. **`hapi tick validate`** — static analysis flags probes that invoke `claude`, `cursor`, `hapi spawn-peer` inside the tick path without a `on_change` gate (allow spawn in probe only when preceded by cheap diff — prefer moving spawn to `on_change` block).
2. **CLI guard on new schedules:** if an agent tries `hapi schedule create --probe …` without `--lane judgment`, refuse with the three-lane menu (mechanical / judgment / cloud).
3. **Skill + AGENTS index row:** “mechanical poll → `hapi tick`; in-session reminder → `CronCreate`; deliver message later → HAPI scheduled message.”
4. **Optional v2:** hub lint when `CronCreate` tool use is detected in a session whose title matches `watch-*` — heavy, defer.

Do **not** block `CronCreate` at the Claude tool layer (upstream/flavor-owned); enforce at HAPI fork docs + scaffolding defaults.

---

## Cross-machine placement

Timers are **always host-local**. Registry field `host:` is documentation + install guard (`hapi tick install` warns when `host != $(hostname)` unless `--force`).

| Watch | Typical host |
|---|---|
| Overseer inbox | oos-linux (HAPI hub) |
| lockhouse producer poll | oos-linux |
| PAT mint alerts | GitHub Actions (not systemd) — `probe.type: gha` is v2 |
| Movie night | oos-linux |
| Trailer-job inbox watch | oos-linux (SSH to proxmox) |

v2: `hapi tick install --remote janus` via existing estate SSH patterns — out of v1 scope.

---

## Smallest useful v1 (shippable beats grand)

**Ship:**

1. **Taxonomy doc** (this file) linked from `docs/operator/AGENTS.md` high-signal index.
2. **`config/ticks.yaml`** with two migrated entries: `overseer-inbox`, `producer-issue-poll` (pointing at existing scripts — no probe rewrite).
3. **`hapi tick {list,validate,install,run,doctor}`** — thin wrapper around existing install scripts + unit generator.
4. **Shared watermark helpers** (`scripts/tooling/lib/hapi-tick-watermark.sh`): `max-id`, `seen-set`, `timestamp-ids` — extracted from overseer + PAT poller logic.
5. **Templates:** `issue-spawn` (producer poll), `inbox-ntfy` (overseer), `inbox-ping-peer` (trailer-job shape A).
6. **Escalation pack:** shared `templates/*-spawn.md` / `*-ping.md` with security boilerplate (externally-authored content warning — already copied by hand in producer poll).

**Defer:**

- Declarative `query` + `filter` probe type (v1.5 — removes per-poller bash+python)
- `until:` / condition-based self-disable (middle case — v1.5)
- Hub DB table for watches
- GHA probe type generator
- Web UI
- Remote multi-host install orchestration
- Replacing `hapi-meta-daily` (different problem: judgment-gated PR classify)

---

## Relationship to nearby HAPI features

| Feature | Relationship |
|---|---|
| `session_job` | Orthogonal — shows progress of long work; does not schedule |
| HAPI `scheduledAt` messages | **Judgment lane** — “wake this session with this text at T” |
| `hapi-meta-daily` | **Batch + policy** — not a generic poller framework |
| `hapi spawn-peer` | **Action primitive** — called from probe scripts today; becomes `on_change.spawn_peer` in registry |
| `hapi-overseer-call.sh` | **Probe helper** for overseer HTTP tools — stays; watch registry references it |
| `/loop` skill | Agent-self-scheduling; never use for mechanical diff |

---

## Open questions for operator sign-off

1. **Name:** **Decided: `hapi tick`** (was working title `hapi watch`; renamed to avoid collision with the HAPI Wear/watch app and hapi-monitor).
2. **Registry split:** all watches in HAPI fork vs repo-local YAML per project (lockhouse-janus owns producer poll file today).
3. **GHA pollers:** first-class `probe.type: workflow` or stay out of HAPI (PAT mint is fine in GHA only).
4. **Issue tracking:** fork issue before implementation (required by product-code guard).
5. **Middle case:** include `until:` in v1 or defer to v1.5? (Antevorta: CI babysit until green.)
6. **Loop vs oneshot timer:** trailer watch uses always-on user service; most polls use `Type=oneshot` + timer — generator must support both.

---

## Next step (post-approval)

File fork issue → worktree → implement v1 CLI + migrate two existing watches → `docs/tooling/hapi-tick.md` operator runbook → link from AGENTS high-signal index. No upstream PR (fork-only surface).
