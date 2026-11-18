# Exit reflection: notify-summary near-miss (tiann/hapi#2481)

## Shipped as

- PR(s): tiann/hapi#2481 — merged by `tiann` 2026-11-18, merge commit `f6d723860`
- Absorber (if superseded): n/a
- Session: `/sessions/bddbd6c0-4f7e-40d8-bbc2-a35204224804` (originator `/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d`)

## Non-code residue

- **Five review rounds, four of them the same bug class.** Rounds 1–3 each enumerated one more piece of quoting syntax (backtick span, quoted span with glued prose, backtick runs) and each shipped with a new hole. The convergent fix was two structural conditions — payload runs to end of line, token owns the line — which test for *the presence of prose* rather than the shape of quotes. Net: the file ended shorter than before the guards accumulated, and no quote character is enumerated anywhere in it.
- **When a bot suggests a fix, the suggestion is a symptom report, not a design.** Declined the suggested fix twice (backtick-run tracking; "protect complete quoted spans") and argued the alternative in-thread. Both declines were right; implementing either would have added a fourth and fifth round.
- **An open string makes truncation and a quoted example byte-identical.** ``Use `AGENT_NOTIFY_SUMMARY {"summary":"` to reproduce.`` has the same payload shape as a real truncation `"summary":"ok`. This refutes *any* payload-shape predicate, not one implementation — which is why token position is the only available signal. Pinned as a test so the next person meets the wall instead of rebuilding it.
- **Background check-watchers read an empty response as green.** An exit test of `[.[]|select(.bucket=="pending")]|length == 0` fires on `[]`. A `-n` guard catches a *failed* command, not an *empty* one. This bit **both** this session and the Meta-side watcher independently, within an hour. Also: `pr-review` is created late, so every visible check can be settled before the finding generator exists.
- **A verdict without a SHA is a verdict about an unknown commit.** The originator pinged about a finding already fixed two commits earlier, because its watcher reported against a stale head. Print arm-time SHA alongside fire-time `headRefOid`.
- **Self-authored `COMMENTED` reviews are not review.** Replying in-thread makes GitHub synthesize an empty-bodied `COMMENTED` review by the replier. #2481 ended with four such rows from `heavygee`, `reviewDecision` empty, and the only other reviewer `github-actions[bot]`. Green CI + resolved threads + those rows still means nobody reviewed it.
- **Pre-existing failures must be proven, not assumed.** 7 hub/cli failures plus 2 flakes were all confirmed by reverting the source files and re-running the same files. One flake (`steerDeliveryLifecycle`) failed 3-of-4 on unpatched `upstream/main` versus 1-of-3 patched.
- **Declining optional scope beats silently dropping it.** The handoff offered truncation *repair* as optional; declined it in the PR body with reasoning (truncation cuts content, not just syntax, so a repaired footer writes a silently shortened summary into an append-only ledger) rather than omitting it quietly.

## Promote?

- [x] `tooling issue` — **Harden check-settled watchers against empty responses.** Any `hapi`/Meta loop that decides "all checks settled" from a pending-count must require (a) parseable response with row count > 0, (b) `pr-review` present *and* finished, (c) no pending — and must print arm-time SHA vs fire-time head. Two independent sessions hit this on one PR in one hour; Meta's own watcher was one of them.
- [x] `lifecycle / tooling doc` — `feature-work-lifecycle.md` § PR chips: note that `✅ full green` plus self-authored `COMMENTED` rows is **not** review; check `reviewDecision` and filter reviewers to non-`heavygee`, non-bot before calling anything reviewed.

## Open questions / landmines

- **Accepted residual:** a truncated footer *glued to prose on the same line* stays visible. Deliberate — status is lost either way, and a visible odd line beats deleting a reader's example before storage on the Codex path. Flipping it is a one-line change; recommendation recorded in-thread against doing so.
- **Accepted residual:** a near-miss inside an *unclosed* code fence is stripped. Verified: closed fences (with or without trailing prose) are intact; only already-malformed Markdown bites.
- **Fork port not started.** Owned by the originator session, deliberately not begun while the PR could still change. The fork matcher differs (`collapseRepeats`, exported `NOTIFY_SUMMARY_TOKEN`), so this will not cherry-pick cleanly onto `driver/integration`.
