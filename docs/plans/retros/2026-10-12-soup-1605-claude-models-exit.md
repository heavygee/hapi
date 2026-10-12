# Exit reflection: soup-1605-claude-models (tiann/hapi#1605)

## Shipped as

- PR(s): tiann/hapi#1605 — CLOSED unmerged (2026-10-02)
- Absorber: n/a (operator DROPPED soup layer 2026-10-08; unmissed)
- Session: Peer soup #1605 / `0d53c7c1-977e-4d0f-a13d-f8b970cb3218`

## Non-code residue

- Whole-tip merge onto `upstream/main` can be clean while per-commit rebase is not — prefer merge-then-squash for soup thin tips.
- Fat PR ancestry onto driver carries unrelated upstream catch-up; use per-file 3-way (`driver` / `upstream/main` / PR tip) for the product-delta paths only.
- SessionChat / App conflicts may pull AGY (or other upstream-only) helpers — keep Claude-only when AGY is not already on the soup tip.
- Orchestrator gate checks can lag local `origin/` — re-verify with `git fetch` + short tip hashes before claiming blocked.
- Manifest layer was DROPPED before this cleanup; Gate A was layer-gone, worktrees leftover until space-relief ping.

## Promote?

- [x] `none` — closed unmerged; no dogfood residue to carry forward

## Open questions / landmines

- n/a (feature not on soup tip; re-open only if operator re-requests catalog)

## Skip

- n/a (short reflection kept)
