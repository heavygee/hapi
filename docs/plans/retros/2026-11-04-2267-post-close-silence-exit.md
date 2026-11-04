# Exit reflection: post-close harness silence (PR #2268)

## Shipped as

- PR(s): [tiann/hapi#2268](https://github.com/tiann/hapi/pull/2268) (Fixes #2267)
- Absorber (if superseded): n/a
- Session: [Peer #2267: post-close notify silence](/sessions/c5da600b-80d5-4114-a144-45412484fb28)

## Non-code residue

- Cursor still injects Briefly-inform after `status:done`; HAPI speech gate is the fix (dogfood PASS on live soup).
- Soft-steer must stay exempt from truncate/suppress; seal is end-anchored only; buried truncate is fence/inline-code aware.
- Driver cwd spawn failed: project `hapi` MCP overlay refuse — dogfood used a clean worktree under `worktrees/`.
- Do not nag Meta PR watcher for remat; tooling meta-bot owns kitchen.

## Promote?

- [x] `none` — no durable follow-up (dogfood note already matches design)

## Open questions / landmines

- Spawning Cursor peers into `~/coding/hapi/driver` can fail MCP overlay when a stale/non-overlay `hapi` key exists — prefer empty worktree dirs for dogfood.

## Skip

- n/a
