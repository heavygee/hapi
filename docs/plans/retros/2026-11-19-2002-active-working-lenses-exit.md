# Exit reflection: 2002-active-working-lenses (tiann/hapi#2376)

## Shipped as

- PR: tiann/hapi#2376 — merged (squash `fa9fd8cc0`, 2026-11-19T13:09:33Z)
- Absorber: n/a
- Session: fda1dbdf-58ed-47df-995c-a209525c2b09

## Non-code residue

- The implementation was already done and live-dogfooded on soup from an earlier peer (Oct 2026) before this session even started — this session's real job turned out to be "lodge the PR, handle what the bot and CI find," not "implement the feature."
- Stacked PR on an unmerged, externally-authored dependency (#1772, techotaku39) is a real and recurring shape here, not a one-off: HOLD → wait for clean base → stack → base goes stale again → re-wait. Took three HOLD/GO cycles over ~8 days before #1772 actually merged.
- **Squash-merge rebase gotcha:** once #1772 squash-merged, a plain `git rebase upstream/main` replayed the *entire* pre-squash commit history of the dependency (git has no way to know the squash commit is tree-equivalent to that whole chain) and reproduced the exact same conflict storm as before the merge. `git rebase --onto upstream/main <old-dependency-tip> <my-branch>` is the fix — replay only commits unique to my branch past the point I originally branched from, not the dependency's superseded history. Worth promoting: anyone stacking on an open PR needs this when that PR lands.
- **Bot review caught a real design gap, not noise:** I'd waved off "Active" as "already covered by the existing status radio" — but that radio is persisted (writes to localStorage, backs the Settings toggle) and the issue's own text explicitly named persisted-Active as "the wrong control for a temporary scan." The bot was right and I was wrong; verified independently before accepting, then implemented the actual missing ephemeral checkbox. Good case for not treating bot pushback as default-noise.
- **CI "flake" that wasn't:** `hub/src/web/routes/cli.test.ts` failed identically 3 runs in a row on the same SHA (same test, same ~5000.1Xms hook timeout, same pass/fail counts) — reproducible, not random. Called this out explicitly rather than assuming "reruns usually fix flakes" after run 1. Turned out to be upstream CI infra (fixed by the orchestrator via #2514/#2515, a 30s hook-timeout bump), confirmed because it was also red on plain `main` post-#1772, independent of my branch.
- Accidentally submitted 3 junk/empty `gh pr review` comments on the live upstream PR from a copy-paste placeholder body mistake. Disclosed immediately rather than hoping no one noticed; could only partially fix (GitHub won't let you delete or edit an already-empty submitted review). Low cost here, but worth being more careful with `gh pr review -b "<body>"` — verify the body string before running, not after.
- Orchestrator caught a false "Ready-YES" they'd sent (based on CI alone, crossed in transit with a real unresolved bot finding I'd just flagged) — I corrected it with a fresh `hapi-pr-status` run rather than accepting the stated status. Also worth promoting: always re-verify a "clean" claim with the tool, even from an authoritative source, when you have reason to think it's stale.

## Promote?

- [x] `lifecycle / tooling doc` — `docs/tooling/pr-review-loop.md` or `driver-soup.md`: add the `git rebase --onto <base> <old-dependency-tip> <branch>` pattern for "my base PR just squash-merged" as a named recipe, next to the existing stacked-PR guidance. Current docs explain *that* stacking happens but not *this specific failure mode* once the base lands.
- [ ] `none`
- [ ] `High-signal index`
- [ ] `tooling issue`

## Open questions / landmines

- `#1996` (blocked-filter lens) is still held on `#1717` and is supposed to stack on this PR's now-merged tip per the orchestrator's confirmed order (`#1772 → #2376 → #1996`) — whoever resumes that peer needs `upstream/main` post-`fa9fd8cc0`, not my now-dead branch.
- Manifest layer 2/3 (`driver/1996-consolidate-blocked-filter-wip`) in `config/driver-manifest.yaml` is still stacked on layer 1/3 (`driver/1772-techotaku-base-wip`) in the recipe — I dropped only my own layer 3/3 (`driver/2002-session-filter-active-working-wip`) this turn. Layer 1/3 (#1772) also merged and likely needs dropping too, but I left that to the orchestrator/Meta since #1996's layer may still depend on its presence in soup until Meta re-threads the stack — didn't want to guess at wave-level sequencing from a single-feature seat.
