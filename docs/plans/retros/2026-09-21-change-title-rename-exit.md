# Exit reflection: change_title rename (#1896)

> Gate A' after upstream merge. Cap: bullets only.

## Shipped as

- PR(s): tiann/hapi#1896 (Fixes #1894), squash `a259ad314`
- Absorber: n/a
- Session: change_title rename (`92804640-d825-4c56-992d-4b3a7c49a95b`)

## Non-code residue

- `change_title` must set `metadata.name` (web rename). Writing only `summary` is invisible once spawn `--name` exists.
- Do not dual-write summary on explicit rename. Native/auto titles stay on `summary` so intentional names keep winning.
- Voice context was a real consumer of `summary` only. Fix the readers (`getSessionTitle`) rather than stuffing summary again.
- Auto Lane B line cap was 118/120 before the voice follow-up. Two formatter files crossed it; `low-impact` kept self-merge.
- Claude Fable cold review is blocked on this host until the data-retention policy is acked. Opus high-effort stood in.
- Lane B grant is TTY-only and SHA-bound. Do not dry-run the merge gate.

## Promote?

- [x] `none` — no durable follow-up

## Open questions / landmines

- Codex `thread/name/updated` still writes `metadata.name` unconditionally, including null. A later native thread name can replace an agent rename. Pre-existing last-writer-wins; not fixed in #1896.

## Skip

- n/a
