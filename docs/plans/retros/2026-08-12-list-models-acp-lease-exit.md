# Exit reflection: list-models-acp-lease (PR #1529)

## Shipped as

- PR(s): tiann/hapi#1529 (Fixes #1520) — merge `df1a56e1` on upstream main
- Absorber: n/a (follow-up to merged #1518)
- Session: 38b2e85e-642c-40e1-bedd-317a02b8a5b5 (peer); orchestration via list-models-acp-lease worktree

## Non-code residue

- Post-#1518 gap was blocker-class for Cursor ACP: check-then-act on `list-models` vs register-before-spawn ACP.
- Spawn lease (`proper-lockfile` on `locks/agent-cli.spawn`) must cover spawn window only — holding for full ACP session regressed to one Cursor session per host.
- Operator dogfood on estate soup + Proxmox hammer; operator merged upstream after blocker comment (lane A expedite, not size-gated routine).
- Merge policy chip `(too_large_delta)` mis-ranks incident severity vs lane-B auto-cap — fringe file count OK at 9.
- `initializeInFlight` coalesce + async lease acquire were babysit hardening after soup regression.
- Lane A default; operator merge on blocker after dogfood — document severity on PR, not chip parens alone.

## Promote?

- [x] `none` — spawn lease is self-contained in shared; #1518+#1529 pair closed #1472 class for Cursor

## Open questions / landmines

- v0.27.3 shipped #1518 without #1529 — users on that tag need upgrade to post-`df1a56e1` main or next release.
- n/a
