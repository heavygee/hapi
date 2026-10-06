#!/usr/bin/env bash
# hapi-pr-create-fork — gate + default target for fork PRs (heavygee/hapi:main).
#
# Use for docs/tooling, scripts/tooling, operator docs, cursor rules — anything
# that must NOT go to tiann/hapi via bare `gh pr create`.
#
# Usage:
#   hapi-pr-create-fork --title "tooling: x" --body-file /tmp/body.md
#   hapi-pr-create-fork --title "tooling: x" --body "$(cat <<'EOF' ... EOF )"
#
# Upstream product PRs: hapi-pr-create (never this script).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
    echo "hapi-pr-create-fork: not in a git repo" >&2
    exit 2
fi
cd "$ROOT"

WRAPPER_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=lib/pr-target-guard.sh
source "$WRAPPER_DIR/lib/pr-target-guard.sh"

FORK_REPO="${HAPI_FORK_PR_REPO:-heavygee/hapi}"
BASE="${HAPI_FORK_PR_BASE:-main}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
    echo "hapi-pr-create-fork: detached HEAD — check out a branch first" >&2
    exit 2
fi

ARGS=("$@")
HAS_REPO=0
HAS_BASE=0
HAS_HEAD=0
TITLE=""
BODY_FILE=""
BODY_TEXT=""

i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
    case "${ARGS[$i]}" in
        --title) TITLE="${ARGS[$((i + 1))]}"; i=$((i + 2));;
        --body-file) BODY_FILE="${ARGS[$((i + 1))]}"; i=$((i + 2));;
        --body) BODY_TEXT="${ARGS[$((i + 1))]}"; i=$((i + 2));;
        --repo|-R) HAS_REPO=1; i=$((i + 2));;
        --base) HAS_BASE=1; i=$((i + 2));;
        --head) HAS_HEAD=1; i=$((i + 2));;
        *) i=$((i + 1));;
    esac
done

if [[ -z "$TITLE" ]]; then
    echo "hapi-pr-create-fork: --title is required" >&2
    exit 2
fi
if [[ -z "$BODY_FILE" && -z "$BODY_TEXT" ]]; then
    echo "hapi-pr-create-fork: --body-file or --body is required" >&2
    exit 2
fi

if [[ $HAS_REPO -eq 0 ]]; then
    ARGS=("--repo" "$FORK_REPO" "${ARGS[@]}")
fi
if [[ $HAS_BASE -eq 0 ]]; then
    ARGS=("--base" "$BASE" "${ARGS[@]}")
fi
if [[ $HAS_HEAD -eq 0 ]]; then
    ARGS=("--head" "$BRANCH" "${ARGS[@]}")
fi

echo "hapi-pr-create-fork: target ${FORK_REPO}:${BASE} ← ${BRANCH}" >&2
export HAPI_PR_CREATE_ACK=1
exec gh pr create "${ARGS[@]}"
