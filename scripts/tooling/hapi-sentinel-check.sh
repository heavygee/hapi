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
REQUIRED=0
REQFILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tree) TREE="$2"; shift 2 ;;
        --manifest) MANIFEST="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        --auto) AUTO=1; shift ;;
        --required) REQUIRED=1; shift ;;
        --required-file) REQFILE="$2"; shift 2 ;;
        # --auto-sample is gone: --auto now reads every identifier, so there is
        # nothing to size. Accepted and ignored so an older caller still runs.
        --auto-sample) err "--auto-sample is obsolete (coverage is complete); ignoring"; shift 2 ;;
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
# COVERAGE IS COMPLETE, AND THAT MATTERS. The first implementation sampled
# `sort -u | head -40` per layer "to bound remat cost". That was not a sample,
# it was an ALPHABETICAL PREFIX: it over-weighted SCREAMING_CASE constants and
# never reached the tail of the alphabet, and because it reported `ok` on the
# layers it had only partly read, the blindness was invisible. Two consecutive
# sweeps over the SAME tip returned different real losses, purely because an
# unrelated change shifted where the cut line fell. A cap that is also an
# ordering silently decides what you never look at.
#
# The fix was to stop sampling. One `git grep -o` pass extracts every
# identifier in the composed tree (~1.6s for 43k names across a 90-layer soup);
# each layer is then a `comm` against that set, which costs nothing. Full
# coverage is now cheaper than the sample was.
#
# KNOWN NOISE, and what is deliberately NOT filtered. Hex-looking tokens are
# dropped — `driver/job-complete-wake` was flagged for `c88c8925` and
# `eb72fcacc7c8`, two halves of a UUID in a test fixture. English words inside
# string literals are NOT dropped (`Adopting`, `Likely`, from a changed log
# message) even though they are noise, because the same filter would blind the
# tool to quoted identifiers like `'search_content'` — and a tool name silently
# dropped from an advertised list is exactly the loss this exists to catch.
# Prefer a few readable false positives over a silent hole.
#
# COMMENT LINES ARE EXCLUDED. First run over 90 layers: 5 flagged, 3 false
# positives, and two of those three were identifiers that only ever appeared in
# PROSE — `driver/a2a-2251-strict-delta` named `pingPeerOptions` in a comment
# explaining a test it was DELETING, and `driver/247-deliberate-fleet-push`
# used the word `Unattended` in a doc comment that was later reworded (all four
# of its exported functions are present). Neither was ever behaviour, so
# neither could be lost. Dropping `//`, `/*`, `*` and `#` lines takes precision
# from 2/5 to 2/3 for free.
#
# The irreducible false positive is a RENAME: `feat/tier-b-reattach-orphan-
# runner-children` declared `adoptedSession`, which a later refactor renamed to
# `adopted` while strengthening the behaviour. Treat every flag as "go look",
# never as "this is broken" — see the triage in
# docs/plans/2026-11-09-sentinel-auto-first-sweep-triage.md.
# Identifiers added by a ref relative to a base, code lines only.
_sentinel_pool() {
    git -C "$TREE" diff "$1" "$2" -- '*.ts' '*.tsx' '*.mjs' '*.js' 2>/dev/null \
        | grep "^+" | grep -v "^+++" \
        | grep -vE "^\+[[:space:]]*(//|/\*|\*|#)" \
        | grep -oE "\b[A-Za-z_][A-Za-z0-9_]{5,}\b" \
        | grep -vE "^[0-9a-f]*[0-9][0-9a-f]*$" \
        | sort -u
}

run_auto() {
    local tip="$1" layers=0 flagged=0
    # One pass over the composed tree yields every identifier in it (~1.6s for
    # 43k names on a 90-layer soup). Every layer is then a set difference, which
    # is free — so there is no sample and no cap, and the earlier
    # `sort -u | head -40` lottery is gone. See the header note.
    local tipsyms; tipsyms="$(mktemp)"
    trap 'rm -f "$tipsyms"' RETURN
    git -C "$TREE" grep -h -oE "\b[A-Za-z_][A-Za-z0-9_]{5,}\b" "$tip" \
        -- '*.ts' '*.tsx' '*.mjs' '*.js' 2>/dev/null | sort -u > "$tipsyms"
    [[ -s "$tipsyms" ]] || die "no identifiers extracted from $tip (tool failure, not a finding)"
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
        local pool; pool="$(_sentinel_pool "$base" "$ref")"
        local pool_n; pool_n="$(printf '%s\n' "$pool" | grep -c . || true)"
        [[ "$pool_n" -gt 0 ]] || { say "ok       $br  (no code identifiers added — nothing to lose)"; continue; }
        local names; names="$(comm -23 <(printf '%s\n' "$pool" | grep .) "$tipsyms" | tr '\n' ' ')"
        local absent; absent="$(printf '%s\n' "$names" | tr ' ' '\n' | grep -c . || true)"
        if [[ "$absent" -gt 0 ]]; then
            echo "LOST     $br" >&2
            echo "         $absent of $pool_n identifier(s) the layer added are absent from the composed tree:" >&2
            echo "         $names" >&2
            # A layer whose diff-vs-parent is huge is not thin: its first parent
            # is not its real base, so the finding is real but the ATTRIBUTION
            # is coarse — the missing code may belong to a neighbour in the
            # range rather than to this branch's own commit.
            local fat; fat="$(git -C "$TREE" diff --shortstat "$base" "$ref" 2>/dev/null)"
            if [[ "$fat" =~ ([0-9]+)\ insertion ]] && [[ "${BASH_REMATCH[1]}" -gt 500 ]]; then
                echo "         note: fat diff vs first parent (${BASH_REMATCH[1]} insertions) — attribution to this branch is approximate" >&2
            fi
            flagged=$((flagged+1))
        else
            say "ok       $br  (all $pool_n layer identifiers intact)"
        fi
    done < "$MANIFEST"
    say ""
    say "auto: $layers layer(s) checked in full against their own diffs, $flagged with missing content"
    [[ "$flagged" -eq 0 ]]
}


# --required: assert the soup's REQUIRED SURFACE, independent of any layer.
#
# A layer sentinel asks "did this layer survive". That cannot protect a symbol
# whose owning layer was re-cut away or that predates every current layer —
# which is precisely how `link_pr` vanished: carried for months by #1163, then
# dropped by a "restore fork tools" commit whose inventory simply omitted it,
# with no layer left claiming it.
#
# Entries live in config/soup-required-surface.yaml. Each is a promise that the
# symbol must be present on :3006 after a remat; a miss fails the rebuild.
run_required() {
    local file="$1" total=0 gone=0 sym path
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*symbol:[[:space:]]*(.+)$ ]]; then
            [[ -n "${sym:-}" ]] && { _req_one "$sym" "${path:-}"; }
            sym="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//; s/^"//; s/"$//')"
            path=""
            total=$((total+1))
            continue
        fi
        if [[ "$line" =~ ^[[:space:]]+path:[[:space:]]*(.+)$ ]]; then
            path="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
        fi
    done < "$file"
    [[ -n "${sym:-}" ]] && _req_one "$sym" "${path:-}"
    say ""
    say "required surface: $total entr(ies) checked, $REQ_GONE missing"
    [[ "$REQ_GONE" -eq 0 ]]
}

REQ_GONE=0
_req_one() {
    local sym="$1" path="$2"
    if [[ -n "$path" ]]; then
        if [[ ! -e "$TREE/$path" ]]; then
            echo "GONE     $sym" >&2
            echo "         required path missing from the composed tree: $path" >&2
            REQ_GONE=$((REQ_GONE+1)); return
        fi
        if grep -qF -- "$sym" "$TREE/$path" 2>/dev/null; then
            say "ok       $sym  ($path)"
        else
            echo "GONE     $sym" >&2
            echo "         required surface absent from $path — remat produced a quietly reduced estate" >&2
            REQ_GONE=$((REQ_GONE+1))
        fi
    else
        if git -C "$TREE" grep -qF -- "$sym" 2>/dev/null; then
            say "ok       $sym"
        else
            echo "GONE     $sym" >&2
            echo "         required surface absent from the composed tree" >&2
            REQ_GONE=$((REQ_GONE+1))
        fi
    fi
}

if [[ "$REQUIRED" -eq 1 ]]; then
    [[ -n "$REQFILE" ]] || REQFILE="$TREE/config/soup-required-surface.yaml"
    [[ -f "$REQFILE" ]] || die "required-surface file not found: $REQFILE"
    if run_required "$REQFILE"; then exit 0; fi
    err "the composed tree is missing surface the fork promises to keep"
    err "see config/soup-required-surface.yaml"
    exit 1
fi

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
declared=0; missing=0; checked=0; current=""; sentinels=(); spath=""

# One layer may declare MANY sentinels. The operator's standing rule (2026-11-11)
# is that everything the manifest claims to keep on the soup gets one, so a
# single `sentinel:` per entry is not expressive enough — a layer that ships
# four MCP tools needs four assertions, not whichever one happened to be last.
# (The previous loop overwrote: a second `sentinel:` line silently replaced the
# first, so only the last was ever checked. That is the same silent-pass class
# this tool exists to close, in the tool itself.)
check_one() {
    local layer="$1" sym="$2" path="$3"
    checked=$((checked+1))
    if [[ -n "$path" ]]; then
        if [[ ! -e "$TREE/$path" ]]; then
            echo "MISSING  $layer" >&2
            echo "         sentinel_path does not exist in the composed tree: $path" >&2
            missing=$((missing+1))
        elif grep -q -- "$sym" "$TREE/$path" 2>/dev/null; then
            say "ok       $layer  ($sym in $path)"
        else
            echo "MISSING  $layer" >&2
            echo "         '$sym' absent from $path — the layer is an ancestor but its behaviour is gone" >&2
            missing=$((missing+1))
        fi
    else
        if git -C "$TREE" grep -q -- "$sym" 2>/dev/null; then
            say "ok       $layer  ($sym present)"
        else
            echo "MISSING  $layer" >&2
            echo "         '$sym' absent from the composed tree — the layer is an ancestor but its behaviour is gone" >&2
            missing=$((missing+1))
        fi
    fi
}

flush_sentinels() {
    local sym
    for sym in ${sentinels+"${sentinels[@]}"}; do
        check_one "$current" "$sym" "$spath"
    done
    sentinels=(); spath=""
}

while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*branch:[[:space:]]*(.+)$ ]]; then
        flush_sentinels
        current="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
        continue
    fi
    if [[ "$line" =~ ^[[:space:]]+sentinel:[[:space:]]*(.+)$ ]]; then
        sym="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//; s/^["'"'"']//; s/["'"'"']$//')"
        [[ -n "$current" ]] || { err "sentinel with no preceding branch entry: $sym"; exit 2; }
        # comma-separated list is accepted too, so one line can carry a set
        local_ifs="$IFS"; IFS=','
        for part in $sym; do
            part="$(echo "$part" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
            [[ -n "$part" ]] && { sentinels+=("$part"); declared=$((declared+1)); }
        done
        IFS="$local_ifs"
        continue
    fi
    if [[ "$line" =~ ^[[:space:]]+sentinel_path:[[:space:]]*(.+)$ ]]; then
        spath="$(echo "${BASH_REMATCH[1]}" | sed 's/[[:space:]]*$//')"
        continue
    fi
done < "$MANIFEST"
flush_sentinels

total_layers="$(grep -c '^[[:space:]]*-[[:space:]]*branch:' "$MANIFEST" || echo 0)"
say ""
say "sentinels: $checked checked, $missing missing, $((total_layers - declared)) of $total_layers layers undeclared"

if [[ "$missing" -gt 0 ]]; then
    err "$missing layer(s) lost their behaviour despite being composed in."
    err "This is the ancestry-vs-presence class — see docs/plans/2026-11-08-ancestry-vs-presence-verification-gap.md"
    exit 1
fi
exit 0
