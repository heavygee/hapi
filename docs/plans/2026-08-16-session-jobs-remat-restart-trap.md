# Session jobs × remat patient-restart trap (2026-08-16)

Dogfood: tooling meta-bot (`05d9f0f2`) wrapped `hapi-driver-rebuild --build-web` in `hapi job run` for #1489 remat. Meter `remat-wake1489` stayed `running` with ~95min-stale heartbeat after promote+build succeeded; operator cleared manually.

## Root cause

`hapi job run` heartbeats from the **supervisor process**, not the agent turn. Remat auto-chains patient `hapi-restart-hub` when hub/cli/shared changed (`scripts/tooling/lib/driver-remat-auto-restart.sh`). Restart can yank the runner/CLI that owns the supervisor → no terminal `completed`/`failed` write → zombie meter in SQLite.

Job-key reuse across attempts is **not** the bug: each `run` mints a new `runId` and PUT-overwrites. Follow-up work *outside* the wrap just left the orphan visible.

## Product stance (session-attached-jobs peer)

- Do **not** auto-`failed` a job on heartbeat silence (stale ≠ failed; live rclone).
- Honest "remat done" includes hub restart — **but** in-tree `exec` after wrap is worse than a chip that completes while hub is still old.

## Mechanical close (2026-10-06, heavygee/hapi#205)

`driver_remat_auto_restart_hub` skips `exec` when `HAPI_INSIDE_JOB_RUN=1` or an ancestor `/proc` cmdline has consecutive `job` `run`. Rebuild exits 0; stderr tells the agent to run `hapi-restart-hub` after the wrap. Tests: `scripts/tooling/lib/driver-remat-auto-restart.test.sh`.

Docs-only `HAPI_DRIVER_NO_RESTART=1` did not stop agents (remat-1933, 2026-10-06).

Kill criterion: if wraps regularly leave soup on an old hub for hours because nobody ran restart, switch to `systemd-run` detach instead of skip.

## Follow-ups

1. Optional: stamp `HAPI_INSIDE_JOB_RUN=1` from soup `hapi job run` (PPID walk is the live fence; env is nicer for nested `bash -c`).
2. Do **not** force unique job-keys on reuse — fence already handles generations.

Related: #1404 / PR #1424, #1489 wake layer, remat auto-restart (2026-08-13), #205.
