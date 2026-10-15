# Claude PR review — Codex quota fallback

## Why this exists

`chatgpt-codex-connector[bot]` (the ChatGPT Codex Cloud SaaS connector that
reviews fork PRs — see [`pr-review-loop.md`](./pr-review-loop.md)) has its
own usage ceiling. When it's hit, it posts:

> You have reached your Codex usage limits for code reviews...

`scripts/tooling/hapi-pr-status.sh` already treats that state as a hard FAIL
("wait for quota / tip-matched Codex wave — cold-review-clean does not skip
this") — correctly, since a quota message is not a review. But "wait" can
mean days on a busy quota, and this estate already runs a self-hosted GitHub
Actions runner (`[self-hosted, hapi]`) with Claude Code available on the same
box. There's no reason a ready diff should sit idle for SaaS quota to refill
when a second reviewer is one workflow away — the pattern is already proven
on `lockhouse` (`lockhouse/setup/.github/workflows/claude-pr-review-reusable.yml`,
running on the same physical `oos-linux` host under a different runner
label).

## What it does

`.github/workflows/claude-codex-fallback-review.yml` triggers **only** on
`chatgpt-codex-connector[bot]`'s own comment or formal review (checked via
the authenticated bot login — not spoofable by typing the phrase into a PR
comment) whose body matches the same phrase `hapi-pr-status.sh` already
matches (`usage limits for code reviews|Codex usage limits`). It does
**not** run on every PR, and does **not** replace Codex when Codex is
working — it is the fallback, not a second standing reviewer.

On a real quota hit it:
1. Confirms the tip hasn't already been covered by a prior fallback run
   (checks for an existing `github-actions[bot]` review containing `Claude
   Fallback Review` + the current head SHA — the quota message can repeat on
   every push while quota stays exhausted, and this is what stops a pile-up
   of duplicate reviews).
2. Checks out the PR's head.
3. Runs `anthropics/claude-code-action@v1` with the same cold-review focus
   (correctness, security, tests, scope) as the house `/requesting-code-review`
   skill, and submits a formal GitHub PR review (`COMMENT` or
   `REQUEST_CHANGES`, never `APPROVE`) — same posting shape
   `hapi-pr-status.sh` / `hapi-pr-reply` already expect for resolving threads.
4. Reports explicitly whether the review actually ran (`$GITHUB_STEP_SUMMARY`)
   — the step is `continue-on-error: true` (advisory; a lapsed credential
   must not itself become a new blocking red X), so "did not run" and "found
   nothing" are written out separately rather than collapsing into the same
   green/red signal. This is the exact incident pattern lockhouse/arthur hit
   on 2026-09-24 when its org secret lapsed; porting the fix along with the
   workflow.

## Turning it on (not done yet — needs operator action)

Off by default via the `CLAUDE_REVIEW_ENABLED` repo variable (unset = job
skipped entirely, no queued runs, no failed runs). Two things needed:

**1. Provision the OAuth token** (same flow as lockhouse; see
`~/coding/lockhouse/setup/docs/operator/claude-pr-review-runners.md`), run on
oos-linux where Claude Code is already logged in:

```bash
claude setup-token
# completes a browser OAuth flow, prints a token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo heavygee/hapi --body "<paste-token>"
```

`heavygee` is a personal GitHub **User** account, not an Org — secrets here
are repo-scoped (`--repo heavygee/hapi`), not org-scoped like lockhouse's.
**Do not** also set `ANTHROPIC_API_KEY` on this repo — the action prefers an
API key over OAuth when both are present, and this is deliberately wired for
the OAuth/subscription path, not Console API billing.

**2. Flip the enable switch:**

```bash
gh variable set CLAUDE_REVIEW_ENABLED --repo heavygee/hapi --body true
```

Verify the self-hosted runner picks up `[self-hosted, Linux, X64, hapi]`
jobs (it already does — same label `.github/workflows/test.yml` uses).

Tokens from `claude setup-token` expire; rotate the same way (re-run
`setup-token`, `gh secret set` again) if the fallback starts reporting "did
NOT run" in a step summary.

## Scope (what this does NOT cover)

- Only triggers on an explicit Codex usage-limit message, not on a tip
  simply being stale/un-reviewed for other reasons (silence isn't a
  reliable enough signal to act on automatically — an agent or `hapi-pr-status`
  should still be the one deciding that and escalating).
- Does not touch `.github/workflows/codex-pr-review.yml` (the fork's own
  `openai/codex-action` workflow, which already fails on every fork PR for
  an unrelated, known, accepted reason — missing `OPENAI_API_KEY`, see
  `pr-review-loop.md` § Fork Codex debt). That failure is expected infra
  noise; this fallback is about `chatgpt-codex-connector[bot]` specifically.
- Verified against real historical data: PR #238 and #34 both have genuine
  `chatgpt-codex-connector[bot]` usage-limit comments on this repo — the
  detection regex and the already-reviewed dedup query were tested directly
  against that real comment text and real PR state (not just synthetic
  fixtures) before this was written up.
