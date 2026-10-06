# Exit reflection: acp-143-false-exit (PR #1518)

## Shipped as

- PR(s): tiann/hapi#1518 (Fixes #1472)
- Absorber: n/a
- Session: 7189ef1c-e766-47f6-a04d-1830117e57a4 (orch: 6ce7f124)

## Non-code residue

- Bot Majors chased mkdir/pid/registering TOCTOUs for days; each fix was real but scope crept.
- Operator split list-models check-then-act to #1520 — chip stayed ⚠️ until merge; correct.
- Per-pid `registering/<pid>` + dead-owner prune was the durable publish pattern vs mtime-only grace.
- Dogfood on :3006 confirmed PONG after concurrent list-models before merge.
- Lane A held; no agent merge.

## Promote?

- [x] `none` — #1520 owns probe-side follow-up; no AGENTS row needed

## Open questions / landmines

- #1520 (exclusive hold / flock on both spawn paths) still needed for full #1472 closure.
- Stale unresolved bot threads on merged PRs confuse Meta until outdated or resolved — expected.
