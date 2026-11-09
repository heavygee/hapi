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

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tree) TREE="$2"; shift 2 ;;
        --manifest) MANIFEST="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
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
