#!/usr/bin/env bash
# Pinned review-posting helper for the Claude Codex-fallback reviewer (cold
# review, 2026-11-01, sixth wave). `Bash(gh pr comment:*)` and `Bash(gh pr
# review:*)` also matched `-F/--body-file <path>`, which reads an arbitrary
# file on this persistent runner and publishes its contents as a public PR
# comment/review — a credential-exfiltration path independent of subprocess
# env scrubbing (which only scrubs env vars, not files). This wrapper never
# accepts a file path: the body always comes from stdin, and the only
# argument it exposes is comment-vs-request-changes.
set -euo pipefail
MODE="${1:?usage: claude-fallback-pr-review.sh <comment|request-changes> <pr-number> <repo>}"
PR_NUMBER="${2:?missing PR number}"
REPO="${3:?missing repo}"
case "$MODE" in
    comment) FLAG=(--comment) ;;
    request-changes) FLAG=(--request-changes) ;;
    *)
        echo "invalid mode: $MODE (expected comment|request-changes)" >&2
        exit 1
        ;;
esac
exec gh pr review "$PR_NUMBER" --repo "$REPO" "${FLAG[@]}" --body-file -
