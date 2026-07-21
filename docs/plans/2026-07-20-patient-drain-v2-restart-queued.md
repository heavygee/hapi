# Patient drain v2 — wait for real idle + restart-queued (no new turns)

> **Status:** framing / build brief. Operator-fork tooling.
> **Date:** 2026-07-20
> **Tracking:** [heavygee/hapi#84](https://github.com/heavygee/hapi/issues/84)
> **Trigger:** `hapi-restart-hub` patient path waited 10m then proceeded with WORKING>0 (yanked in-flight agents). Operator correction: that is the wrong safety valve.

---

## Operator contract (non-negotiable)

1. **If there are WORKING agents, there are WORKING agents.** Patient drain waits until they are not WORKING. A 10-minute auto-proceed is not an acceptable substitute for waiting.
2. **Legitimate turns can exceed 10 minutes.** Timeout-as-yank is wrong for that case.
3. **If WORKING is sticky because of false positives / deadlocks, fix the detector** — do not teach the restart wrapper to ignore WORKING.
4. **While a restart is queued, agents must know and must not start a new turn**, so the fleet can actually drain instead of thrashing forever as new turns begin.

`--impatient` (TTY-gated / batch-ack) remains the **only** path that intentionally kills live work.

---

## What broke today (2026-07-20)

Agent ran canonical `hapi-restart-hub` (no `--impatient`). Drain logged:

```
patient: TIMEOUT after 623s with WORKING=3 -- proceeding anyway
Restarting hapi-hub-oos.service hapi-runner-oos.service ...
```

Hub bounced with sessions still mid-turn. That matched the documented default (`HAPI_PATIENT_TIMEOUT=600` → proceed), which the operator has now rejected as policy.

Related backlog (still open): `docs/plans/2026-06-13-patient-drain-working-detection.md` — WORKING is often only `thinking=true`, so mid-turn gaps between tool calls look idle (false negatives). Today's incident was the opposite failure mode of the timeout valve (proceed while WORKING>0), but both belong to one drain reliability workstream.

---

## Target architecture (three layers)

```
┌─────────────────────────────────────────────────────────────┐
│  Operator / agent: hapi-restart-hub | hapi-use-worktree     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer A — Restart-queued flag (hub)                        │
│  File or hub API: drain requested at T0                     │
│  Broadcast to CLI/runners: "do not start new turns"         │
│  Existing mid-turn work continues to completion             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer B — Accurate WORKING probe                           │
│  Fix false idle (thinking gap) + false sticky WORKING       │
│  Identify *who* is WORKING (id/tag — known gap today)       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer C — Drain wait                                       │
│  Default: wait until effective WORKING==0 (no yank timeout) │
│  Only --impatient proceeds with WORKING>0                   │
│  Optional operator advisory after N minutes (log/notify),   │
│  still no auto-yank                                         │
└─────────────────────────────────────────────────────────────┘
```

### Layer A — Restart-queued / no-new-turns (the missing piece)

**Problem today:** drain only *waits*. It does not stop the fleet from *starting more work*. As long as operators (or Overseer, or peers) keep sending messages, WORKING never reaches zero.

**Desired behavior:**

| Event | Behavior |
|---|---|
| Drain begins | Hub enters `restart_queued` (or `drain_mode`) |
| Mid-turn agent | Finishes current turn normally |
| New user / RPC send into a session | Rejected or queued with clear reason: `restart_queued` |
| Runner spawn of new remote sessions | Blocked while drain active |
| Drain clears (WORKING==0) or cancel | Flag cleared; normal accepts resume |
| Impatient restart | May skip wait; still should set flag briefly or document yank |

**Surfaces that must honor the flag:**

- Hub REST send / RPC that starts a turn
- Runner `spawn` / resume that would start agent work
- Ideally: web composer shows “restart queued — sends paused”
- Agent-visible notice (session event or system message) so agents that poll hub state can cooperate

**Storage sketch (cheap, single-machine):**

- `~/.hapi/restart-queued.json` written by `hapi-restart-hub` / `hapi-use-worktree` at drain start, cleared on exit (success or cancel)
- Hub watches file or exposes `GET/POST /api/ops/drain` so CLI doesn’t need a private filesystem contract only
- Prefer hub API as source of truth; file can be bootstrap for scripts when hub is already wedged

### Layer B — WORKING accuracy

Ship / finish `2026-06-13-patient-drain-working-detection.md`:

- Do not rely solely on `thinking=true`
- Prefer turn-complete contract (`AGENT_NOTIFY_SUMMARY`) + recency where applicable
- Fix `id: null, tag: null` in health JSON so drain logs name the blockers
- Separate **STUCK?** (too long thinking / dead PIDs) from **WORKING** — STUCK should surface for operator action, not silently hold forever *or* auto-yank; policy TBD (notify + optional promote to impatient only with TTY)

### Layer C — Drain wait policy

| Setting | New default | Meaning |
|---|---|---|
| `HAPI_PATIENT_TIMEOUT` | `0` (wait forever) | Never auto-proceed with WORKING>0 |
| Proceed with WORKING>0 | **only** `--impatient` / `HAPI_IMPATIENT=1` (+ existing TTY/batch gates) | Explicit yank |
| Advisory | e.g. log every 5m: still WORKING, list ids | Visibility without yank |

Update `driver-soup.md` and wrapper help text accordingly (remove “10min then proceed” as the blessed path).

---

## Phased delivery

### Phase 0 — stop the bleeding (tooling only, same day)

- Default `HAPI_PATIENT_TIMEOUT=0` in `hapi-restart-hub` and `hapi-use-worktree` / shared `patient-drain.sh`
- On timeout path: **delete** “proceeding anyway”; if someone sets a positive timeout, treat expiry as **fail closed** (exit non-zero, do not restart) unless `--impatient`
- Docs: patient = wait for idle; impatient = yank

### Phase 1 — restart-queued flag (hub + scripts)

- Scripts set drain flag at start of patient_drain; clear in EXIT trap
- Hub refuses new turn-starting sends while flag set (with clear error)
- Web: composer disabled / banner when drain active
- Broadcast lightweight SSE/ops event so status UIs update

### Phase 2 — WORKING probe fix

- Implement 2026-06-13 plan; health JSON includes real session ids/tags
- Align STUCK vs WORKING policy with operator

### Phase 3 — agent cooperation

- Document + optionally inject a short system notice into active sessions: “hub restart queued; finish current turn; do not begin new work”
- Overseer (when live): treat restart-queued as fleet edict — no new dispatches

---

## Non-goals

- Making `--impatient` easier for agents (keep TTY/batch gates)
- Auto-killing STUCK sessions without operator intent
- Replacing flock / driver-status coordination

---

## Acceptance

- Default `hapi-restart-hub` never restarts while effective WORKING>0
- With restart-queued active, a new user message cannot start a turn
- Mid-turn agents can finish; WORKING reaches 0 without timeout yank
- Impatient path still works from a real TTY when the operator means to yank
- Health probe names who is blocking the drain

---

## Immediate follow-up

Phase 0 lands in this workstream first (scripts + docs). Phase 1 needs a tracking issue + worktree (hub product code).
