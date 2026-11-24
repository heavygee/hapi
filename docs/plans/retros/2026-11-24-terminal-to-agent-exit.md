# Exit reflection: terminal-to-agent (PR #2012)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): tiann/hapi#2012 (closes #2011); squash tip `ad9fa5d711`
- Absorber (if superseded): n/a
- Session: [terminal-to-agent](/sessions/a2269736-c282-4c26-b9da-6b60ac1f8043)

## Non-code residue

- Bot Minors were real: xterm `isWrapped` must join without newlines (keep wrap-boundary spaces); markdown fences must be longer than any backtick run in the body (`cat README` closes a fixed ``` early).
- Lane B blocked by `too_large_delta` (tests+locales inflate) - correct call; Lane A wait was fine.
- Feature worktree vanished before this 🔧 ping; soup thin + manifest layer still owed - Gate A is layer+soup wt, not only the session path.
- Session cwd was already a husk (`1012-1439`, no `.git`) - good for spawn; do not `rm -rf` the path before Meta archive.
- `GH_TOKEN` from lhs.ghe.com poisoned `gh` for github.com mid-cleanup - `unset GH_TOKEN` + `gh auth switch --user heavygee` before PR ops.

## Promote?

- [x] `none` — no durable follow-up (wrap/fence lessons already in the merged code + bot review trail)
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`

## Open questions / landmines

- Soup tip `e89bcf2bd` lagged upstream tip `3b8597cc7` (wrap/fence fix) - dogfood on :3006 may have missed the review fix until remat; prefer tip-forward soup after addressing bot findings next time.

## Skip

- n/a
