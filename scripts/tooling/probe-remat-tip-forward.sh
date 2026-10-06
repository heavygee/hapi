#!/usr/bin/env bash
# Isolated tip-forward (T) vs full-recipe (F) remat conflict probe.
# NEVER touches driver/ or promotes. Writes results under /tmp and optional --out.
#
# Usage: probe-remat-tip-forward.sh [--out DIR]
set +e
set -uo pipefail

REPO="${HAPI_REPO:-/home/heavygee/coding/hapi}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hapi-manifest-path.sh
source "$SCRIPT_DIR/lib/hapi-manifest-path.sh"
MANIFEST="$(hapi_manifest_path "$REPO")"
DRIVER="${HAPI_DRIVER:-$REPO/driver}"
OUT="/tmp/remat-tip-forward-probe"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --out) OUT="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

rm -rf "$OUT"
mkdir -p "$OUT"

TIP=$(git -C "$DRIVER" rev-parse HEAD)
UP=$(git -C "$REPO" rev-parse upstream/main)

mapfile -t LAYERS < <(python3 - <<PY
import re, pathlib
mf = pathlib.Path("$MANIFEST").read_text()
for line in mf.splitlines():
    m = re.match(r"\s+-\s+branch:\s+(\S+)", line)
    if m and not line.strip().startswith("#"):
        print(m.group(1))
PY
)

{
    echo "TIP=$TIP"
    echo "UP=$UP"
    echo "git=$(git --version)"
    echo "layers=${#LAYERS[@]}"
    echo "started=$(date -Is)"
} | tee "$OUT/meta.txt"

first_line() {
    # Avoid pipefail+head SIGPIPE under set -e callers.
    local s=$1
    printf '%s\n' "${s%%$'\n'*}"
}

# Writes $OUT/$label.{tree,conflicts,rc}; appends status line to logfile.
# Returns via $OUT/$label.rc only (never relies on function exit under set -e).
do_merge() {
    local base="$1" side="$2" label="$3" logfile="$4"
    local raw rc=0 tree
    raw=$(git -C "$REPO" merge-tree --write-tree --name-only "$base" "$side" 2>"$OUT/${label}.err")
    rc=$?
    tree=$(first_line "$raw")
    printf '%s\n' "$tree" > "$OUT/${label}.tree"
    printf '%s\n' "$rc" > "$OUT/${label}.rc"
    if [[ $rc -eq 0 ]]; then
        : > "$OUT/${label}.conflicts"
        echo "CLEAN $label tree=${tree:0:12}" | tee -a "$logfile" >/dev/null
        echo "CLEAN $label tree=${tree:0:12}" >> "$OUT/steps.log"
        return 0
    fi
    if [[ $rc -eq 1 ]]; then
        printf '%s\n' "$raw" | awk '
            NR==1 { next }
            /^$/ { exit }
            /^Auto-merging |^CONFLICT |^warning:/ { exit }
            { print }
        ' > "$OUT/${label}.conflicts"
        local n
        n=$(wc -l < "$OUT/${label}.conflicts")
        echo "CONFLICT $label files=$n tree=${tree:0:12}" | tee -a "$logfile"
        echo "CONFLICT $label files=$n tree=${tree:0:12}" >> "$OUT/steps.log"
        return 0
    fi
    echo "ERROR $label rc=$rc" | tee -a "$logfile"
    printf '%s\n' "$raw" >> "$logfile"
    return 0
}

# ---------- F: full-recipe from upstream ----------
echo "=== F full-recipe ===" | tee "$OUT/F.log"
F_HEAD=$UP
: > "$OUT/F.union"
F_CONFLICT_STEPS=0
F_CLEAN_STEPS=0
F_FIRST_FAIL=""
F_T0=$(date +%s%N)

for i in "${!LAYERS[@]}"; do
    b="${LAYERS[$i]}"
    n=$((i + 1))
    label="F-$(printf '%02d' "$n")-$(echo "$b" | tr '/' '_')"
    echo "-- Layer $n/${#LAYERS[@]}: $b onto ${F_HEAD:0:12}" | tee -a "$OUT/F.log"
    do_merge "$F_HEAD" "$b" "$label" "$OUT/F.log"
    rc=$(cat "$OUT/${label}.rc")
    tree=$(cat "$OUT/${label}.tree")
    if [[ -z "$tree" || "$tree" == ERROR* ]]; then
        echo "ABORT F at $b (no tree)" | tee -a "$OUT/F.log"
        break
    fi
    if [[ "$rc" -eq 0 ]]; then
        F_CLEAN_STEPS=$((F_CLEAN_STEPS + 1))
    elif [[ "$rc" -eq 1 ]]; then
        F_CONFLICT_STEPS=$((F_CONFLICT_STEPS + 1))
        if [[ -z "$F_FIRST_FAIL" ]]; then
            F_FIRST_FAIL="$n:$b"
        fi
        cat "$OUT/${label}.conflicts" >> "$OUT/F.union"
    else
        echo "ABORT F at $b rc=$rc" | tee -a "$OUT/F.log"
        break
    fi
    side_sha=$(git -C "$REPO" rev-parse "$b")
    F_HEAD=$(git -C "$REPO" commit-tree "$tree" -p "$F_HEAD" -p "$side_sha" -m "probe-F merge $b")
done

F_T1=$(date +%s%N)
F_MS=$(( (F_T1 - F_T0) / 1000000 ))
sort -u "$OUT/F.union" -o "$OUT/F.union"
F_UNIQUE=$(wc -l < "$OUT/F.union" | tr -d ' ')
echo "F_SUMMARY clean=$F_CLEAN_STEPS conflict_steps=$F_CONFLICT_STEPS unique_conflict_files=$F_UNIQUE first_fail=$F_FIRST_FAIL wall_ms=$F_MS final=${F_HEAD:0:12}" \
    | tee -a "$OUT/F.log" | tee "$OUT/F.summary"
echo "$F_HEAD" > "$OUT/F.head"

# ---------- T: tip-forward ----------
echo "=== T tip-forward ===" | tee "$OUT/T.log"
T_HEAD=$TIP
: > "$OUT/T.union"
T_CONFLICT_STEPS=0
T_CLEAN_STEPS=0
T_SKIPPED=0
T_MERGED=0
T_FIRST_FAIL=""
T_NON_ANCESTORS=()
T_T0=$(date +%s%N)

if git -C "$REPO" merge-base --is-ancestor "$UP" "$T_HEAD"; then
    echo "upstream already ancestor — skip" | tee -a "$OUT/T.log"
else
    label="T-00-upstream"
    do_merge "$T_HEAD" "$UP" "$label" "$OUT/T.log"
    rc=$(cat "$OUT/${label}.rc")
    tree=$(cat "$OUT/${label}.tree")
    T_MERGED=$((T_MERGED + 1))
    if [[ "$rc" -eq 0 ]]; then
        T_CLEAN_STEPS=$((T_CLEAN_STEPS + 1))
    elif [[ "$rc" -eq 1 ]]; then
        T_CONFLICT_STEPS=$((T_CONFLICT_STEPS + 1))
        T_FIRST_FAIL="upstream"
        cat "$OUT/${label}.conflicts" >> "$OUT/T.union"
    fi
    T_HEAD=$(git -C "$REPO" commit-tree "$tree" -p "$T_HEAD" -p "$UP" -m "probe-T merge upstream")
fi

for i in "${!LAYERS[@]}"; do
    b="${LAYERS[$i]}"
    n=$((i + 1))
    sha=$(git -C "$REPO" rev-parse "$b")
    if git -C "$REPO" merge-base --is-ancestor "$sha" "$T_HEAD"; then
        echo "-- Layer $n: SKIP ancestor $b" | tee -a "$OUT/T.log"
        T_SKIPPED=$((T_SKIPPED + 1))
        continue
    fi
    T_NON_ANCESTORS+=("$b")
    label="T-$(printf '%02d' "$n")-$(echo "$b" | tr '/' '_')"
    echo "-- Layer $n: MERGE $b onto ${T_HEAD:0:12}" | tee -a "$OUT/T.log"
    do_merge "$T_HEAD" "$b" "$label" "$OUT/T.log"
    rc=$(cat "$OUT/${label}.rc")
    tree=$(cat "$OUT/${label}.tree")
    T_MERGED=$((T_MERGED + 1))
    if [[ "$rc" -eq 0 ]]; then
        T_CLEAN_STEPS=$((T_CLEAN_STEPS + 1))
    elif [[ "$rc" -eq 1 ]]; then
        T_CONFLICT_STEPS=$((T_CONFLICT_STEPS + 1))
        if [[ -z "$T_FIRST_FAIL" ]]; then
            T_FIRST_FAIL="$n:$b"
        fi
        cat "$OUT/${label}.conflicts" >> "$OUT/T.union"
    else
        echo "ABORT T at $b rc=$rc" | tee -a "$OUT/T.log"
        break
    fi
    T_HEAD=$(git -C "$REPO" commit-tree "$tree" -p "$T_HEAD" -p "$sha" -m "probe-T merge $b")
done

T_T1=$(date +%s%N)
T_MS=$(( (T_T1 - T_T0) / 1000000 ))
sort -u "$OUT/T.union" -o "$OUT/T.union"
T_UNIQUE=$(wc -l < "$OUT/T.union" | tr -d ' ')
{
    echo "T_SUMMARY skipped=$T_SKIPPED merged=$T_MERGED clean=$T_CLEAN_STEPS conflict_steps=$T_CONFLICT_STEPS unique_conflict_files=$T_UNIQUE first_fail=$T_FIRST_FAIL wall_ms=$T_MS final=${T_HEAD:0:12}"
    echo "T_NON_ANCESTORS=${T_NON_ANCESTORS[*]-}"
} | tee -a "$OUT/T.log" | tee "$OUT/T.summary"
echo "$T_HEAD" > "$OUT/T.head"

echo "==== RESULTS ===="
cat "$OUT/F.summary"
cat "$OUT/T.summary"
echo "--- F conflict files (unique $F_UNIQUE) ---"
cat "$OUT/F.union"
echo "--- T conflict files (unique $T_UNIQUE) ---"
cat "$OUT/T.union"
echo "OUT=$OUT"
