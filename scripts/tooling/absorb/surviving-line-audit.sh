#!/usr/bin/env bash
# Report source lines that BOTH the merge-base AND the upstream parent still
# carry, but the composed tree does not.
#
# WHY THIS SHAPE. The identifier sweep (hapi-sentinel-check --auto) asks "did a
# name survive". That cannot see a VALUE regression, where every name is still
# present and only the content changed. The 11-23 case:
#
#     base:      agy: new Set([Capabilities.ModelChange, Capabilities.Effort]),
#     upstream:  agy: new Set([Capabilities.ModelChange, Capabilities.Effort]),
#     fork:      agy: new Set([Capabilities.ModelChange]),
#     composed:  agy: new Set([Capabilities.ModelChange]),      <- regression
#
# Capabilities.Effort still occurs all over that file, so no identifier went
# missing and --auto was right to stay quiet. The line-level question catches
# it: upstream never removed Effort from agy, and neither did the shared
# history, so its absence has to be explained.
#
# It was not a fork decision either. At d9b6c54f4 ("absorb fork main into the
# soup") fork main carried the Effort line and the soup did not; the merge kept
# the soup's side, and the same pass renamed the test to 'agy supports
# model-change but not effort' so the suite stayed green. A three-way rule would
# read base==upstream!=fork as "the fork changed it, the fork wins" and keep the
# regression — which is why this audit asks about MERGE PROVENANCE rather than
# just the three-way shape.
#
# A hit is NOT automatically a bug. The fork legitimately removes upstream code.
# The output is a work list to adjudicate, and the `merge-only` marker says
# which hits deserve suspicion first: no non-merge fork commit ever touched that
# file, so no human ever decided to drop the line.
#
# Usage: surviving-line-audit.sh <base> <upstream> <fork> [path-prefix...]
set -euo pipefail

BASE="${1:?base ref}"; UP="${2:?upstream ref}"; FORK="${3:?fork ref}"
shift 3
PREFIXES=("$@")
[[ ${#PREFIXES[@]} -gt 0 ]] || PREFIXES=(cli/src hub/src web/src shared/src)

# Lines too short or too generic to mean anything on their own: closing braces,
# `})`, `return`, bare keywords. A one-token line matches thousands of places
# and would drown the real hits.
meaningful() {
    grep -vE '^[[:space:]]*(//|/\*|\*|$)' \
        | grep -vE '^[[:space:]]*[})\];,]*[[:space:]]*$' \
        | awk '{ s=$0; gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); if (length(s) >= 24) print s }'
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mapfile -t files < <(
    git diff --name-only "$BASE" "$UP" -- "${PREFIXES[@]}" \
        | grep -E '\.tsx?$' \
        | grep -vE '\.(test|spec)\.tsx?$|/__tests__/|/test/'
    git diff --name-only "$BASE" "$FORK" -- "${PREFIXES[@]}" \
        | grep -E '\.tsx?$' \
        | grep -vE '\.(test|spec)\.tsx?$|/__tests__/|/test/'
)
mapfile -t files < <(printf '%s\n' "${files[@]}" | sort -u)

echo "scanning ${#files[@]} source file(s) touched by either side"
echo

total=0; hitfiles=0
for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue   # deleted in the composed tree: a different question
    git show "$BASE:$f" 2>/dev/null | meaningful | sort -u > "$tmp/base" || continue
    git show "$UP:$f"   2>/dev/null | meaningful | sort -u > "$tmp/up"   || continue
    [[ -s "$tmp/base" && -s "$tmp/up" ]] || continue
    meaningful < "$f" | sort -u > "$tmp/mine"
    comm -12 "$tmp/base" "$tmp/up" > "$tmp/kept"
    comm -23 "$tmp/kept" "$tmp/mine" > "$tmp/gone"
    n=$(grep -c . "$tmp/gone" || true)
    [[ "$n" -gt 0 ]] || continue
    # Did any human ever edit this file on the fork side, or is its whole
    # divergence the residue of merge resolutions?
    marker=""
    if [[ -z "$(git log --no-merges --format='%h' "$BASE..$FORK" -- "$f" 2>/dev/null | head -1)" ]]; then
        marker="  [merge-only: no deliberate fork commit ever touched this file]"
    fi
    hitfiles=$((hitfiles + 1)); total=$((total + n))
    echo "$f  — $n line(s) kept by base AND upstream, absent here$marker"
    head -4 "$tmp/gone" | sed 's/^/      /'
    [[ "$n" -gt 4 ]] && echo "      … $((n - 4)) more"
done

echo
echo "surviving-line-audit: $total line(s) across $hitfiles file(s) need an explanation"
[[ "$total" -eq 0 ]]
