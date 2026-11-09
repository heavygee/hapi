#!/usr/bin/env bash
# hapi-pr-merge-verdict — cross-check GitHub's mergeable verdict against a real
# local trial merge, and name the conflicting files when it is real.
#
# WHY: GitHub's `mergeable` / `mergeable_state` is a CACHED computation, and it
# lags pushes. On 2026-11-09 a session watched #238 report CONFLICTING for 4+
# minutes after a push that had already fixed the conflict; GitHub's own
# `refs/pull/238/merge` still had the PREVIOUS push as its 2nd parent, so the
# verdict was not merely late, it had not been attempted against the new head.
#
# That matters because fork tooling TRUSTS the field:
#   lib/pr-emoji-core.sh    dirty/behind -> "rebase (merge state dirty)" chip
#   hapi-pr-merge-gate.sh   anything != MERGEABLE -> hard fail
# so a stale verdict sends a session off to rebase a branch that merges fine.
#
# THE TRAP THIS TOOL EXISTS TO AVOID. The obvious check — compare the 2nd
# parent of `refs/pull/N/merge` to the PR head, and call a mismatch "stale" —
# is WRONG, and it is wrong in the dangerous direction. GitHub stops updating
# that ref both when it is still computing AND when the PR genuinely conflicts;
# in both cases it keeps serving the last successful test merge. So a mismatch
# proves only "no merge commit exists for this head", which is exactly what a
# real conflict looks like. Trusting it would turn every genuine conflict into
# a confident "GitHub is just being slow".
#
# The only ground truth is a local trial merge against a CURRENT origin/main —
# and "current" is load-bearing: the #238 case flipped from clean to genuinely
# conflicted mid-investigation because main moved under it.
#
# Usage:
#   hapi-pr-merge-verdict [--repo owner/name] <pr-number> [--base <ref>] [--quiet]
#
# Exit: 0 merges clean · 1 genuinely conflicts · 2 cannot determine (tool
#       failure, never a finding — callers must not read this as either answer).
set -euo pipefail

err() { echo "hapi-pr-merge-verdict: $*" >&2; }
die() { err "$*"; exit 2; }

REPO="${HAPI_PR_REPO:-heavygee/hapi}"
BASE="origin/main"
QUIET=0
PR=""
HEAD_OVERRIDE=""
NO_FETCH=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO="$2"; shift 2 ;;
        --base) BASE="$2"; shift 2 ;;
        # --head skips API head resolution: used by the tests (which must run
        # offline) and useful when you already know the sha.
        --head) HEAD_OVERRIDE="$2"; shift 2 ;;
        --no-fetch) NO_FETCH=1; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
        -*) die "unexpected arg: $1" ;;
        *) PR="$1"; shift ;;
    esac
done

[[ -n "$PR" ]] || die "usage: hapi-pr-merge-verdict [--repo owner/name] <pr-number>"
[[ "$PR" =~ ^[0-9]+$ ]] || die "pr number must be numeric: $PR"
command -v git >/dev/null 2>&1 || die "git not on PATH"

say() { [[ "$QUIET" == "1" ]] || echo "$*"; }

# GitHub's cached opinion, for comparison only — never as the answer.
GH_STATE="unknown"
if command -v gh >/dev/null 2>&1; then
    GH_STATE="$(gh api "repos/${REPO}/pulls/${PR}" --jq '.mergeable_state // "unknown"' 2>/dev/null || echo unknown)"
fi

# GitHub's cached opinion is irrelevant when the caller supplied the head.
[[ -n "$HEAD_OVERRIDE" ]] && GH_STATE="unknown"

# The PR head. Prefer the API; fall back to the pull ref so this still works
# when gh is unavailable or rate-limited.
HEAD_SHA="$HEAD_OVERRIDE"
if [[ -z "$HEAD_SHA" ]] && command -v gh >/dev/null 2>&1; then
    HEAD_SHA="$(gh api "repos/${REPO}/pulls/${PR}" --jq '.head.sha // empty' 2>/dev/null || true)"
fi
if [[ -z "$HEAD_SHA" ]]; then
    git fetch -q origin "refs/pull/${PR}/head:refs/tmp/prverdict-${PR}" 2>/dev/null \
        || die "cannot resolve head for PR #${PR} (no API, no pull ref)"
    HEAD_SHA="$(git rev-parse "refs/tmp/prverdict-${PR}")"
fi
git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null \
    || git fetch -q origin "refs/pull/${PR}/head" 2>/dev/null || true
git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null || die "head $HEAD_SHA not fetchable"

# "Current" is the whole point: a verdict against a stale base is the bug.
[[ "$NO_FETCH" -eq 1 ]] || git fetch -q origin 2>/dev/null \
    || err "warning: could not refresh origin; base may be stale"
BASE_SHA="$(git rev-parse --verify --quiet "$BASE")" || die "base not resolvable: $BASE"

OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
rc=0
git merge-tree --write-tree "$HEAD_SHA" "$BASE_SHA" > "$OUT" 2>/dev/null || rc=$?

if [[ "$rc" -eq 0 ]]; then
    say "MERGES CLEAN   #${PR} (head ${HEAD_SHA:0:9}) into ${BASE} (${BASE_SHA:0:9})"
    if [[ "$GH_STATE" == "dirty" || "$GH_STATE" == "behind" ]]; then
        say "  GitHub says '${GH_STATE}' — STALE VERDICT. Do not send anyone to rebase."
        say "  GitHub's cache lags pushes; this tree merges right now."
    fi
    exit 0
fi

if [[ "$rc" -ne 1 ]]; then
    die "git merge-tree failed (exit $rc) — cannot determine, not a finding"
fi

# Conflicted entries are the unmerged index stages at the top of the output;
# naming the files is the difference between an actionable report and "dirty".
FILES="$(awk 'NF==4 && $3 ~ /^[123]$/ { print $4 }' "$OUT" | sort -u)"
say "CONFLICTS      #${PR} (head ${HEAD_SHA:0:9}) vs ${BASE} (${BASE_SHA:0:9})"
[[ "$GH_STATE" == "unknown" ]] || say "  GitHub says '${GH_STATE}' — agrees with the local trial merge."
if [[ -n "$FILES" ]]; then
    say "  conflicting path(s):"
    printf '    %s\n' $FILES
    # A path present at stages 1 and 3 but not 2 was deleted on the PR side
    # while the base modified it. On this fork that is usually a feat/ branch
    # that merged main, hit the fork-path-policy hook on docs/operator/, and
    # stripped the file — which conflicts again on every main-side edit.
    # Rebasing instead of merging avoids it entirely.
    while read -r p; do
        [[ -n "$p" ]] || continue
        s2="$(awk -v f="$p" 'NF==4 && $3=="2" && $4==f' "$OUT" | wc -l)"
        if [[ "$s2" -eq 0 ]]; then
            say "    ^ modify/delete: deleted on the PR side, modified on ${BASE}."
            say "      If this is docs/operator/, rebase onto ${BASE} rather than"
            say "      merging it in and stripping the file — see docs/operator/tooling-meta-role.md"
        fi
    done <<< "$FILES"
fi
exit 1
