# Cold PR Review Rubric

Distilled from [`.github/prompts/codex-pr-review.md`](../../.github/prompts/codex-pr-review.md). Use this for `/requesting-code-review` before **every** push to a branch with an open upstream PR — not only at `gh pr create`.

## Scope

Review the **full PR diff** against the PR base branch:

```bash
git fetch origin
git diff origin/<base>...HEAD
```

On follow-up pushes, review the full diff again. Upstream bot re-runs on the latest head; your cold read must match that scope.

## Severity levels

| Level | Meaning |
|-------|---------|
| **Blocker** | Correctness bug, security hole, data loss, broken build/CI — must fix before push |
| **Major** | Regression, missing error handling, race/lifecycle bug, inadequate tests for changed behavior |
| **Minor** | Maintainability, naming, edge case with low blast radius |
| **Nit** | Style, optional polish — note only |

Map to the review skill: Blocker/Major = Critical/Important; fix before push.

## What to check

1. **Correctness** — logic matches intent; state mutations traced through full lifecycle (connect → active → disconnect → reconnect where relevant).
2. **Security** — no secret leakage; validate untrusted input; no unsafe defaults.
3. **Regressions** — existing behavior preserved unless intentionally changed.
4. **Data loss** — persistence, sync, cache invalidation, versioned updates.
5. **Performance** — avoid obvious hot-path waste in changed code.
6. **Maintainability** — matches repo conventions (`AGENTS.md`, package READMEs, 4-space indent, strict TS).
7. **Tests** — changed behavior has coverage; note gaps as Major if behavior is non-trivial.

## Review bar (match upstream bot)

Upstream HAPI Bot (`.github/prompts/codex-pr-review.md`) now assesses in order **requirement → approach → code** (then notes testing). Cold reads should match that gate order — do not dive into line bugs before the use case and mechanism are sound.

- **Stage 1 Requirement** — concrete use case / expected behavior / why it fits HAPI; stop if unclear or wrong-scoped.
- **Stage 2 Approach** — mechanism solves the root cause within existing responsibilities; optional suggestions do not block code review.
- **Stage 3 Code** — only after both pass: findings ordered by severity (`Blocker` / `Major` / `Minor` / `Nit`).
- **Evidence**: cite `path:line` from the diff (and linked issues when claiming a requirement).
- **No speculation** — if uncertain, say so or ask (max 4 questions).
- **Diff focus** — only flag issues on added/changed lines; use context lines to validate, not to nit unchanged code.
- **High signal** — if confidence &lt; 80%, do not report as a finding.
- **Concrete fixes** — every Blocker/Major includes a minimal suggested change.
- **No praise** — issues and risks only.

On GitHub, the same `github-actions[bot]` posts the staged formal review **and** inline threads for code findings — not a second reviewer.

## HAPI-specific context

Monorepo: `cli/`, `hub/` (or `server/`), `web/`, `shared/`. Run verification from repo root (`bun typecheck`, `bun run test`) for touched packages.

## Output format (for your own notes)

Mirror the upstream staged shape (short is fine):

```markdown
**Requirement — Pass|Needs changes|Needs clarification**
- …

**Approach — Pass|Needs changes|Needs clarification|Not reviewed**
- …

**Code — Reviewed|Not reviewed**
- [Blocker|Major|Minor|Nit] Title — evidence `path:line`
  Suggested fix: …
(or: No reportable code issues.)

**Testing**
- Ran / not run; gaps

Ready to push: yes/no
```

Legacy `**Findings**` / `- None.` notes are still readable on older tips; prefer the staged shape for new colds.

## After upstream bot comments

Reply to each **inline** thread with fix SHA + one sentence. Resolve with `resolveReviewThread`. Requirement/Approach objections live in the formal review body — address in PR description / follow-up commits, then wait for the next tip bot pass. See [pr-review-loop.md](./pr-review-loop.md).

## Full court press

When the operator wants to **minimize HAPI Bot back-and-forth** on a high-stakes tip, escalate beyond a single cold read: two sequential Cursor agent peers (Claude high-effort, then GPT Sol) — see [pr-review-loop.md § Full court press](./pr-review-loop.md#full-court-press-escalate-when-bot-thrash-must-die). Same severity bar and "run tests before verdict" rules apply to **both** passes.
