# Exit reflection: search-scope-toggle-2081 (tiann/hapi#1598, Fixes #2081)

## Shipped as

- PR(s): tiann/hapi#1598 — squashed as `82c5c00a3`, carrying #1554 + #2081
- Absorber (if superseded): n/a
- Session: Peer #2081 / PR #1598 content search dogfood

## Non-code residue

- First PR through the `dogfooded` opt-out process (Discussion #2083). It ran ~10
  days past the 48h window; follow-up posted there owning the overrun.
- Scope grew far beyond the issue: a dropdown→toggle became toggle + string-content
  indexing + search-anchor + forward-reading (~10 commits, ~15 review findings) +
  GFM indexing. All real, but the growth happened inside a third-party contributor's
  PR, which is what made it expensive.
- Forward-reading had no browser coverage at any of the four points where findings
  landed. Unit/wiring guards were accepted each time and the gap was declared
  in-thread rather than papered over. Still owed.
- Soup layers `driver/2081-search-scope-toggle` and `driver/2081-forward-reading`
  dropped from the manifest this wave; Meta rematerialises.
- A `hapi-sync-fork-main` here triggered a tip-forward remat conflict across 7
  unrelated files (ACP, session cache, row summary) and set an estate-wide hold.
  Cost ~1h of another session's time. Sync → remat is not free during a wave.
- One review thread was deliberately left open and later closed by others: the
  suggested fix contradicted an invariant the author had set on purpose
  (`do not issue a second context request during render hand-off`), and broke
  4 tests. Reverting and writing up why was the right call.

## Promote?

- [x] `tooling issue` — **Lane B grant is consumed by a standalone gate run.**
  `hapi-pr-merge-gate.sh` is documented as "also runnable alone", and the grant as
  "consumed on use". Running the gate to *preview* the verdict burns the operator's
  single-use token, and the subsequent `gh pr merge` then blocks. Burned one grant
  this way. Either the standalone path should not consume, or the help should say
  plainly: never pre-run the gate against a live grant.
- [x] `lifecycle / tooling doc` — `scripts/tooling/hapi-laneb-authorise.sh`: fixed
  (`d6ec85a0e`) so a pasted trailing newline no longer reads as an empty answer and
  aborts. Operator reported it burning grants "literally every time".

## Open questions / landmines

- Forward-reading's end-to-end scroll path still rests on unit/wiring tests. A
  Playwright test reading forward past the 600-row window is the honest follow-up.
- `prep/1598-merge-candidate` (the verified split that was never needed) is deleted
  with this cleanup; the split point was always the author's own merge commit, which
  is worth remembering if a future PR needs extracting from a contributor's branch.
