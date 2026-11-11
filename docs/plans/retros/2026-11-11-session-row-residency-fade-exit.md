# Exit reflection: session-row residency fade (tiann/hapi#2362)

## Shipped as

- PR(s): **tiann/hapi#2362** — merged by @tiann 2026-11-11T00:58:25Z (`a29fe7b32`, tip `dffb5738a`), released in 0.34.6. Umbrella #2356 item 4.
- Side PR: **heavygee/hapi#326** — `hapi-pr-status.sh` reads Codex's `codex-review-state:v1`. Open, fork-side.
- Unlanded follow-up: **`fix/session-row-fade-tooltip-stacking`** (`0cd8475d3`, pushed to fork) — see landmines.
- Absorber: n/a — soup layer `driver/session-row-residency-fade` dropped from `config/driver-manifest.yaml` 2026-11-11.
- Session: `/sessions/205260d9` (peer under `/sessions/c89dc806`).

## Non-code residue

- **The fork-stage gate was un-passable for ~2 days and nobody noticed.** Codex switched to a `codex-review-state:v1` comment; `hapi-pr-status` matched only the legacy `Reviewed commit:` prose, so dimension 3 said UNKNOWN for *every* fork PR (#309/#311 were already affected). Because `cold-review-clean` correctly refuses to invent a tip-match, the only way through was `--skip-fork-stage`. A gate that can only say "unknown" trains people to bypass it. Fixed in #326.
- **`git stash` is repo-global across worktrees.** Mid-task another session stashed between my push and pop; my pop took theirs, conflicted, and left a foreign `UU hub/src/store/migration-v24.test.ts` in my tree — and silently invalidated a "before" screenshot. Orchestrator logged it to `docs/tooling/git-stash-policy.md` + `.cursor/rules/no-stash-others-work.mdc`. Use temp-edit + `git checkout HEAD -- <path>`.
- **Draft fork PRs never get reviewed.** The connector triggers on open / ready-for-review / `@codex review`. `hapi-pr-create`'s help text suggests `--draft` for the fork stage, which guarantees no review arrives (draft #303 sat 10 days). Worth correcting in that help text.
- **The premise moved mid-flight.** #2296 (per-state presence badge) merged while this was open, which is *why* the PR went DIRTY. Rebasing onto it improved the pitch — same predicate (`!active`), two scales — rather than invalidating it. Re-shot the proof, since the original predated #2296 and had become misleading.
- Proof images are content-safe by construction: driven through the existing `session-list-scroll-fixture` with synthetic names, never the live fleet.

## Promote?

- [x] `lifecycle / tooling doc` — `docs/tooling/pr-review-loop.md` + `hapi-pr-create` help: say the fork-stage PR must be **non-draft** (or `@codex review`), because the connector does not review drafts. Current guidance actively produces a dead gate.
- [x] `tooling issue` — *"hapi-pr-status: upstream bot verdict is not tip-checked"*. The fork branch is strict about tip-ahead; the upstream branch takes the latest `github-actions[bot]` review by `submitted_at` and never compares `commit_id` to HEAD. It did not misfire here (the follow-up review landed in time, which I verified rather than assumed), but after a force-push it can report PASS from a pre-rebase review. `commit_id` is already on the review object.

## Open questions / landmines

- **A confirmed review finding is live in merged main.** The bot's Minor on #2362 — the fade sits on the title grid, which also holds the inline `z-30` schedule/attention tooltip panels, so `opacity < 1` forms a stacking context that washes them out and traps their z-index under later rows — was correct, and #2362 merged before the fix landed. Repro: inactive session + scheduled messages, Extended mode. Fix and a structural regression test are on the fork at `fix/session-row-fade-tooltip-stacking` (`0cd8475d3`), verified against merged main: 18/18 row tests, `tsc` clean, and the new test fails against the unfixed shape (positive control). **Needs an upstream PR decision — it is not mine to open post-merge without a call.**
- The fade is applied to passive text (title + trailing cluster) in that fix rather than a container. Any future refactor that hoists it back onto a container reintroduces the bug; the new test is the guard.
