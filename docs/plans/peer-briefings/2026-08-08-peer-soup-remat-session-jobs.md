# Soup remat: session-attached jobs (#1404) — tip f1a1e1801

**Role:** Meta tooling / soup rematerialize. Operator asked (via feature peer) to get #1404 into soup on `:3006`.

**Parent / orchestrator:** `/sessions/6e70f97b-24c6-49bd-907f-98ce9bfc8b8f` (Peer: session-attached jobs)

## What / why

Layer already in manifest: `driver/session-attached-jobs` (stale tip `1d32152db` / feat `d76dcf216`).
Feat tip to dogfood: `f1a1e1801` on `origin/feat/session-attached-jobs` — includes:
- cold-pass-2 Major fix (MetadataSchema job redirect keys)
- PUT explicit `startedAt` / CLI `--started-at`
- **MCP `session_job`** (catalog discoverability)
- docs / steer updates

Hub + CLI + shared + web all touched → rebuild + **`hapi-restart-hub`** after verify.

## Peer-owned steps

1. Precheck: `hapi-driver-status --quiet` (exit 0 idle; 75 wait; 76 hold → ping Meta)
2. Refresh soup branch from feat tip (do **not** hand-edit `~/coding/hapi/driver`):
   - Update `origin/driver/session-attached-jobs` so it includes `f1a1e1801` (merge/rebase/cherry as this estate's soup-branch pattern for this layer; keep SCHEMA renumber if soup-only V23 still required)
   - Push `origin/driver/session-attached-jobs`
3. Update tip comments in `~/.config/hapi/driver-manifest.yaml` (+ commit mirror `config/driver-manifest.yaml` if that is the mess-maker path for this estate)
4. From `~/coding/hapi` mirror (clean enough):
   ```bash
   hapi-driver-status --quiet
   hapi-driver-rebuild --build-web --verify
   hapi-verify-web-dist
   hapi-restart-hub   # hub/cli/shared/MCP changed
   ```
5. Smoke: `hapi job --help` on soup PATH shows `session_job` / job subcommands; optional `hapi inspect-peer` self + note MCP tool list if easy.
6. Ping parent `6e70f97b` with: new soup tip SHA, rebuild OK, hub restart done, any SCHEMA note.

## Do not

- Stack-switch (`hapi-use-worktree` / `hapi-use-driver` / activate)
- Hand-edit `~/coding/hapi/driver` tree / copy web dist
- Open upstream PR (feature peer owns that later)
- Merge on `tiann/hapi`

## Close the loop

1. `hapi ping-peer 6e70f97b` with remat status + soup tip + pointer to this session
2. `AGENT_NOTIFY_SUMMARY`
