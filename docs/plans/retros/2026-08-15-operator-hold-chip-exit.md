# Exit reflection: operator-hold-chip (fork PR #124)

## Shipped as

- PR(s): heavygee/hapi#124 — merge `a801dcd2e` on fork main (not tiann)
- Absorber: n/a; #129 closed/superseded by this stack
- Session: Peer #121 operator-hold chip (worktree `operator-hold-chip`)

## Non-code residue

- Classifier + `hapi-hold-ack` live on fork **main** (hourly timer). Soup `driver/operator-hold-chip` is pulse UI only — do not drop that layer as Gate A for this PR.
- Lane B quiet merge never fired: `too_many_files` (15>8). Green + idle for two days until operator told Meta to merge.
- Hold-ack no-TTY bypass had to become unforgeable (sidecar cookie + non-live `--state`). Env-alone `ALLOW_NO_TTY` is a lie.
- Agent `HAPI_AGENT_CONTEXT=1` refuse is necessary but insufficient (`env -u` strips it). TTY gate remains the operator boundary.
- Codex last comment was usage-limit quota, not a finding — do not treat quota nags as ⚠️ work.

## Promote?

- [x] `High-signal index` — `docs/operator/AGENTS.md` still says hold latch is **not** on the hourly timer / not in live yaml. After #124 that row is stale; Meta should flip it to: 🛑 = stop, operator `hapi-hold-ack`, dogfood `HAPI_PR_HOLD_LOGINS=heavygee` (no fake tiann).

## Open questions / landmines

- Live Meta state ack is TTY-only. Tests need `--state` fixture + `.hold-ack-test` cookie; forging `/tmp` does not clear production.
- `script`/`pty` still punches the TTY gate (estate wrapper-gap, not a new fence).
- UI soup worktree `operator-hold-chip-ui` is a different owner — leave it.

## Skip

- n/a
