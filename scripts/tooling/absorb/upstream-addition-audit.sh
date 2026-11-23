#!/usr/bin/env bash
# "Upstream additions are always taken" — measured, not asserted.
#
# For every source file upstream changed since the merge-base, take the lines
# upstream ADDED and ask whether each one is present in the composed tree.
#
# This is the direct test of the absorb's first rule. The three other audits
# answer adjacent questions and would all stay quiet here:
#
#   hapi-sentinel-check --auto   did a NAME survive. Blind to a changed value.
#   surviving-line-audit         lines base AND upstream both still carry.
#                                Blind to anything upstream ADDED after base.
#   suite-census                 did tests stop RUNNING.
#
# Presence is positional-blind on purpose: a line that moved to another file
# still counts as present. That under-reports rather than over-reports, which
# is the right bias for a list someone has to work through by hand.
#
# Lines shorter than 24 characters and comment lines are skipped: `})` and
# `return null` match everywhere and would bury the real hits.
#
# A hit is a question. The fork may delete upstream code deliberately, and
# upstream may have reformulated a line so its old text is legitimately gone.
# But every hit has to be explained, because this is the rule the first absorb
# broke: it promoted green while missing 209 of 293 upstream-added files.
#
# Usage: upstream-addition-audit.sh <base> <upstream> [--tests] [path...]
set -euo pipefail

BASE="${1:?base ref}"; UP="${2:?upstream ref}"; shift 2
INCLUDE_TESTS=0
[[ "${1:-}" == "--tests" ]] && { INCLUDE_TESTS=1; shift; }
PATHS=("$@"); [[ ${#PATHS[@]} -gt 0 ]] || PATHS=(cli/src hub/src web/src shared/src relay/src)

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
total=0; files=0

while read -r f; do
    [[ -n "$f" ]] || continue
    if [[ "$INCLUDE_TESTS" -eq 0 ]] && [[ "$f" =~ \.(test|spec)\.tsx?$ ]]; then continue; fi
    # Deleted upstream: that is a removal to honour, not an addition to keep.
    git cat-file -e "$UP:$f" 2>/dev/null || continue
    git diff "$BASE" "$UP" -- "$f" \
        | grep -E '^\+[^+]' \
        | sed 's/^+//; s/^[[:space:]]*//; s/[[:space:]]*$//' \
        | grep -vE '^(//|/\*|\*)' \
        | awk 'length($0) >= 24' | sort -u > "$tmp/want" || true
    # `|| true` is load-bearing: under `set -o pipefail` the first file whose
    # upstream diff has no long non-comment additions makes grep exit 1 and
    # kills the whole run. Without it this audit silently reported 3 files
    # instead of 41 — and an audit that stops early reads exactly like a clean
    # one.
    [[ -s "$tmp/want" ]] || continue
    tot=$(grep -c . "$tmp/want")
    if [[ -f "$f" ]]; then
        sed 's/^[[:space:]]*//; s/[[:space:]]*$//' "$f" | sort -u > "$tmp/mine"
        comm -23 "$tmp/want" "$tmp/mine" > "$tmp/gone"
    else
        cp "$tmp/want" "$tmp/gone"
    fi
    n=$(grep -c . "$tmp/gone" || true)
    [[ "$n" -gt 0 ]] || continue
    files=$((files + 1)); total=$((total + n))
    printf '%4d/%-4d  %s%s\n' "$n" "$tot" "$f" "$([[ -f "$f" ]] || echo '   [FILE ABSENT]')"
    sed 's/^/          /' "$tmp/gone" | head -3
    [[ "$n" -gt 3 ]] && echo "          … $((n - 3)) more"
done < <(git diff --name-only "$BASE" "$UP" -- "${PATHS[@]}" | grep -E '\.tsx?$')

echo
echo "upstream-addition-audit: $total upstream-added line(s) absent across $files file(s)"
[[ "$total" -eq 0 ]]
