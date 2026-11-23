#!/usr/bin/env bash
# Assert that the number of tests that RAN has not dropped.
#
# WHY. On 2026-11-23, taking upstream's registerCommonHandlers.ts pulled in an
# import of a module the fork had lost entirely. The result:
#
#     before:  54 failed | 6196 passed            (6288 tests)
#     after:   74 failed | 5518 passed            (5630 tests)
#
# 658 tests stopped running. The failure count moved by 20, which reads like a
# small regression, and `bun run test` still printed a tidy summary. A missing
# import does not fail one assertion here -- it deletes whole suites from the
# run, and every per-test metric looks almost normal because the denominator
# shrank with the numerator.
#
# A pass rate cannot see this. Only the absolute count can, which is why the
# floor lives in a file instead of being derived from the current run.
#
# The floor is a RATCHET: when the real total goes up, raise it (this script
# prints the line to paste). Never lower it to make a run pass -- a legitimate
# drop means tests were deliberately deleted, and that belongs in a commit
# message, not in this file.
#
# Usage: suite-census.sh [--update] [package...]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
FLOOR_FILE="config/absorb-suite-floor.tsv"
UPDATE=0
[[ "${1:-}" == "--update" ]] && { UPDATE=1; shift; }
PKGS=("$@")
[[ ${#PKGS[@]} -gt 0 ]] || PKGS=(shared relay hub cli web)

declare -A floor=()
if [[ -f "$FLOOR_FILE" ]]; then
    while IFS=$'\t' read -r pkg n _; do
        [[ -z "$pkg" || "$pkg" == \#* ]] && continue
        floor["$pkg"]="$n"
    done < "$FLOOR_FILE"
fi

fail=0
declare -A got=()
for pkg in "${PKGS[@]}"; do
    [[ -d "$pkg" ]] || continue
    out="$(mktemp)"
    (cd "$pkg" && timeout 2400 bun run test > "$out" 2>&1) || true
    # bun's own reporter: "N pass" / "N fail"; vitest: "Tests  N failed | M passed (T)"
    total=""
    if grep -qE '^ *Tests ' "$out"; then
        total="$(grep -E '^ *Tests ' "$out" | tail -1 | grep -oE '\(([0-9]+)\)' | tr -d '()')"
    else
        p="$(grep -oE '^ *([0-9]+) pass' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)"
        f="$(grep -oE '^ *([0-9]+) fail' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)"
        s="$(grep -oE '^ *([0-9]+) skip' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)"
        total=$(( p + f + s ))
    fi
    rm -f "$out"
    [[ -n "$total" && "$total" -gt 0 ]] || { echo "ERROR    $pkg: could not read a test total (tool failure, not a finding)"; fail=1; continue; }
    got["$pkg"]="$total"
    want="${floor[$pkg]:-}"
    if [[ -z "$want" ]]; then
        echo "new      $pkg: $total tests ran (no floor recorded yet)"
    elif [[ "$total" -lt "$want" ]]; then
        echo "COLLAPSE $pkg: $total tests ran, floor is $want — $((want - total)) test(s) stopped RUNNING. Look for an unresolved import, not a failing assertion."
        fail=1
    elif [[ "$total" -gt "$want" ]]; then
        echo "ratchet  $pkg: $total tests ran (floor $want) — raise the floor"
    else
        echo "ok       $pkg: $total tests ran (floor $want)"
    fi
done

if [[ "$UPDATE" -eq 1 ]]; then
    { echo "# Minimum number of tests that must RUN per package. A ratchet: raise it"
      echo "# when the real total rises, never lower it to make a run pass. See"
      echo "# scripts/tooling/absorb/suite-census.sh for why a pass rate cannot"
      echo "# replace this."
      for pkg in "${!got[@]}"; do printf '%s\t%s\n' "$pkg" "${got[$pkg]}"; done | sort
    } > "$FLOOR_FILE"
    echo
    echo "wrote $FLOOR_FILE"
    exit 0
fi

exit "$fail"
