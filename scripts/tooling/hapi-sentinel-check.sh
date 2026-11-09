#!/usr/bin/env bash
# hapi-sentinel-check — assert a layer's BEHAVIOUR survived into the composed tree.
#
# WHY: ancestry containment is not presence. A layer can be a provable ancestor
# of the tip (`git rev-list --count <layer> ^<tip>` = 0) while a later
# conflict-resolution-by-rewrite has silently deleted its code. Three confirmed
# losses in four days, every one found by accident when somebody tried to USE
# the missing thing:
#
#   2026-11-05  pingPeer.ts      resolve-by-agentSessionId (#1203) deleted by a
#                                "clear remat verify failures" rewrite. Invisible
#                                for three days; surfaced as agents unable to
#                                cite each other by durable id.
#   2026-11-09  RenameSessionDialog.tsx  upstream #2072's title-lock gone; its
#                                commit IS an ancestor. Found by a peer with
#                                nothing to attach an FUE callout to.
#   2026-11-09  startHappyServer.ts  search_content nearly dropped from the
#                                advertised tool list mid-merge — caught only
#                                because an unrelated typecheck failed.
#
# Tests cannot catch this class: the 11-05 loss passed `--verify` because no
# test covered the deleted feature. Typecheck cannot either — nothing breaks
# when a feature stops being offered. So assert the symbol directly.
#
# Manifest syntax (optional, per layer; unknown keys are ignored by
# parse-driver-manifest.mjs, so this cannot break a remat):
#
#   - branch: driver/foo
#     sentinel: someSymbolOnTheCallPath
#     sentinel_path: cli/src/modules/foo/foo.ts     # optional, narrows the grep
#
# Prefer a symbol on the CALL PATH over a declaration: a declaration can survive
# while its only caller is deleted, which is the same adjacent-question trap.
#
# Usage:
#   hapi-sentinel-check [--tree <dir>] [--manifest <file>] [--quiet]
#
# Exit: 0 all declared sentinels present · 1 one or more missing · 2 usage error.
set -euo pipefail

err() { echo "hapi-sentinel-check: $*" >&2; }
die() { err "$*"; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TREE="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
MANIFEST=""
QUIET=0
AUTO=0
AUTO_SAMPLE="${HAPI_SENTINEL_AUTO_SAMPLE:-40}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tree) TREE="$2"; shift 2 ;;
        --manifest) MANIFEST="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        --auto) AUTO=1; shift ;;
        --auto-sample) AUTO_SAMPLE="$2"; shift 2 ;;
        -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
        *) die "unexpected arg: $1" ;;
    esac
done

[[ -d "$TREE" ]] || die "tree not found: $TREE"
# Default to the manifest INSIDE the composed tree: that is the one the remat
# actually used, not whatever the mirror happens to have checked out.
[[ -n "$MANIFEST" ]] || MANIFEST="$TREE/config/driver-manifest.yaml"
[[ -f "$MANIFEST" ]] || die "manifest not found: $MANIFEST"

say() { [[ "$QUIET" == "1" ]] || echo "$*"; }


# --auto: derive the check from each layer's own diff instead of a declaration.
#
# Declared sentinels only protect features somebody already thought to protect,
# and every real loss so far was one nobody imagined. This mode needs no
# foresight: take the identifiers the layer ADDED relative to its base, and
# assert they are still present in the composed tree. If a conflict resolution
# deleted the layer's code, its own identifiers go missing and this says so.
#
# Sampled (default 40 identifiers/layer) to keep remat cost bounded; layers are
# thin by policy, so a sample is usually the whole set.
run_auto() {
    local tip="$1" layers=0 flagged=0
    while IFS= read -r line; do
        [[ "$line" =~ ^[[:space:]]*-[[:space:]]*branch:[[:space:]]*(.+)$ ]] || continue
        local br; br="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
        local ref="origin/$br"
        git -C "$TREE" rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || ref="$br"
        git -C "$TREE" rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || continue
        local base; base="$(git -C "$TREE" rev-list --max-count=1 "${ref}^" 2>/dev/null || true)"
        [[ -n "$base" ]] || continue
        # A SKIPPED layer (fat-tip gate) is legitimately absent from the tip.
        # Only an ABSORBED layer losing its content is the bug we are hunting.
        [[ "$(git -C "$TREE" rev-list --count "$ref" ^"$tip" 2>/dev/null || echo 1)" == "0" ]] || continue
        layers=$((layers+1))
        local absent=0 names=""
        while read -r sym; do
            [[ -n "$sym" ]] || continue
            git -C "$TREE" grep -q -- "$sym" "$tip" 2>/dev/null || { absent=$((absent+1)); names="$names $sym"; }
        done < <(git -C "$TREE" diff "$base" "$ref" -- '*.ts' '*.tsx' '*.mjs' '*.js' 2>/dev/null \
                 | grep "^+" | grep -v "^+++" \
                 | grep -oE "\b[A-Za-z_][A-Za-z0-9_]{5,}\b" \
                 | sort -u | head -"$AUTO_SAMPLE")
        if [[ "$absent" -gt 0 ]]; then
            echo "LOST     $br" >&2
            echo "         $absent identifier(s) the layer added are absent from the composed tree:$names" >&2
            flagged=$((flagged+1))
        else
            say "ok       $br  (layer identifiers intact)"
        fi
    done < "$MANIFEST"
    say ""
    say "auto: $layers layer(s) checked against their own diffs, $flagged with missing content"
    [[ "$flagged" -eq 0 ]]
}

if [[ "$AUTO" -eq 1 ]]; then
    command -v git >/dev/null 2>&1 || die "git not on PATH (tool failure, not a finding)"
    TIP="$(git -C "$TREE" rev-parse HEAD 2>/dev/null)" || die "cannot resolve HEAD in $TREE (tool failure, not a finding)"
    if run_auto "$TIP"; then
        exit 0
    fi
    err "layer content lost despite being composed in — ancestry is not presence"
    err "see docs/plans/2026-11-08-ancestry-vs-presence-verification-gap.md"
    exit 1
fi

# Walk the manifest line by line, same shape as parse-driver-manifest.mjs, so a
# sentinel always binds to the branch entry directly above it.
declared=0; missing=0; checked=0; current=""
while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*branch:[[:space:]]*(.+)$ ]]; then
        current="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
        sentinel=""; spath=""
        continue
    fi
    if [[ "$line" =~ ^[[:space:]]+sentinel:[[:space:]]*(.+)$ ]]; then
        sentinel="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//; s/^["'"'"']//; s/["'"'"']$//')"
        [[ -n "$current" ]] || { err "sentinel with no preceding branch entry: $sentinel"; exit 2; }
        declared=$((declared+1))
        continue
    fi
    if [[ "$line" =~ ^[[:space:]]+sentinel_path:[[:space:]]*(.+)$ ]]; then
        spath="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
    fi

    # A blank line or the next entry closes the current one — run its check.
    if [[ -n "${sentinel:-}" ]]; then
        checked=$((checked+1))
        if [[ -n "${spath:-}" ]]; then
            if [[ ! -e "$TREE/$spath" ]]; then
                echo "MISSING  $current" >&2
                echo "         sentinel_path does not exist in the composed tree: $spath" >&2
                missing=$((missing+1))
            elif grep -q -- "$sentinel" "$TREE/$spath" 2>/dev/null; then
                say "ok       $current  ($sentinel in $spath)"
            else
                echo "MISSING  $current" >&2
                echo "         '$sentinel' absent from $spath — the layer is an ancestor but its behaviour is gone" >&2
                missing=$((missing+1))
            fi
        else
            if git -C "$TREE" grep -q -- "$sentinel" 2>/dev/null; then
                say "ok       $current  ($sentinel present)"
            else
                echo "MISSING  $current" >&2
                echo "         '$sentinel' absent from the composed tree — the layer is an ancestor but its behaviour is gone" >&2
                missing=$((missing+1))
            fi
        fi
        sentinel=""; spath=""
    fi
done < "$MANIFEST"

total_layers="$(grep -c '^[[:space:]]*-[[:space:]]*branch:' "$MANIFEST" || echo 0)"
say ""
say "sentinels: $checked checked, $missing missing, $((total_layers - declared)) of $total_layers layers undeclared"

if [[ "$missing" -gt 0 ]]; then
    err "$missing layer(s) lost their behaviour despite being composed in."
    err "This is the ancestry-vs-presence class — see docs/plans/2026-11-08-ancestry-vs-presence-verification-gap.md"
    exit 1
fi
exit 0
