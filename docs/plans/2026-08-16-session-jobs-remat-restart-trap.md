# Session jobs × remat patient-restart trap (2026-08-16)

Dogfood: tooling meta-bot (`05d9f0f2`) wrapped `hapi-driver-rebuild --build-web` in `hapi job run` for #1489 remat. Meter `remat-wake1489` stayed `running` with ~95min-stale heartbeat after promote+build succeeded; operator cleared manually.

## Root cause

`hapi job run` heartbeats from the **supervisor process**, not the agent turn. Remat auto-chains patient `hapi-restart-hub` when hub/cli/shared changed (`scripts/tooling/lib/driver-remat-auto-restart.sh`). Restart can yank the runner/CLI that owns the supervisor → no terminal `completed`/`failed` write → zombie meter in SQLite.

Job-key reuse across attempts is **not** the bug: each `run` mints a new `runId` and PUT-overwrites. Follow-up work *outside* the wrap just left the orphan visible.

## Product stance (session-attached-jobs peer)

- Do **not** mark remat `completed` before patient restart finishes by default — that would lie about "done."
- Prefer docs + recipe: `HAPI_DRIVER_NO_RESTART=1` inside `hapi job run`, restart outside the wrap (optional second short job for drain chrome).
- Agent idle mid-drain is fine while supervisor lives; looks broken only when supervisor dies.

## Follow-ups

1. Docs (`docs/guide/session-jobs.md` on #1424 or post-merge): "do not wrap self-restarting remat" trap + NO_RESTART recipe.
2. Optional later: remat script prints a one-liner warning when `HAPI_SESSION_ID` is set and restart will run.
3. Do **not** force unique job-keys on reuse — fence already handles generations.

Related: #1404 / PR #1424, #1489 wake layer, remat auto-restart (2026-08-13).
