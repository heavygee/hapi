# Exit reflection: github-pr-awareness (tiann/hapi#1163)

## Shipped as

- PR(s): tiann/hapi#1163 — merged by `tiann` 2026-11-18, squash merge `e55d29c056`
- Absorber (if superseded): n/a (#1160/#1161 closed into this PR)
- Session: `/sessions/b30cf5c0-633b-420f-bc10-26229e07f598` (Meta PR watcher `/sessions/1e32daba-7b7e-4955-9264-dde6e78723f3`)

## Non-code residue

- **GitHub mergeability is a cached opinion.** REST and GraphQL are separate caches and can both say CLEAN/MERGEABLE while a local trial merge against freshly fetched `upstream/main` conflicts. Seen on this PR (~14 behind); rematch on trial-merge ground truth, not API agreement.
- **Fifteen Ready YES reports, fifteen accurate** (one mid-settle refuse when upstream moved under the tip — correct void, not a false green). Meta adopted trial-merge as a fifth verify gate after pattern 3.
- **Carried unrelated CI fix is a rematch tax.** Passkey browser harness landed via standalone #2455; leaving a lockstep copy in #1163 forced forever-identical-file conflict resolution. Drop carried copy + PR-body "happy to split" note on the rematch after the absorber merges.
- **`SessionList.tsx` stays hot.** Prefer merge rematch + rerere / take-theirs-keep-ours over rebase when the contested file also absorbs unrelated upstream UI (fork-preview #2421).
- **Lane A + `too_many_files`** — babysit prepare-only for ~110 days; arithmetic of maintainer wait is not the peer's to fix. Cadence that kept it mergeable: live verify, ground-truth rematch, prompt Ready YES, idle.
- **Void From: must use live `HAPI_SESSION_ID`** — remembered/handoff session ids produce chip-void failures.

## Promote?

- [x] `High-signal index` — one row for `docs/operator/AGENTS.md`:

  | When | Do | Detail |
  | Before Ready YES / rematch decision on upstream PR | Local trial merge vs freshly fetched base — do not trust REST/GraphQL alone | Both caches can agree and still be stale; Meta verify now includes trial-merge. Lifecycle § Meta PR watcher / Ready YES |

- [ ] `lifecycle / tooling doc` — optional one-liner in `feature-work-lifecycle.md` Ready YES gates listing trial-merge (if Meta wants the index row only, leave unchecked)

## Open questions / landmines

- Squash merge means feature tip SHAs are not ancestors of `upstream/main` — branch delete is "PR merged", not `merge-base --is-ancestor` of the tip.
- Soup layer `driver/github-pr-awareness` dropped this turn; remat is Meta wave job — do not rematerialize mid-wave.
