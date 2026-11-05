#!/usr/bin/env bash
# hapi-remat-upstream-drift — tip-forward visibility report.
#
# Tip-forward remat can leave live soup missing upstream commits that already
# landed on fork main (or on upstream/main). Operator 2026-11-05: want a hot-file
# / "upstream commits not in tip" report, not only one file (sessionLastSeen).
#
# Usage:
#   hapi-remat-upstream-drift              # tip = live driver/integration
#   hapi-remat-upstream-drift --tip REF    # compare REF
#   hapi-remat-upstream-drift --json
#
set -euo pipefail

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$PRIMARY/driver}"
UPSTREAM_REF="${HAPI_UPSTREAM_REF:-upstream/main}"
ORIGIN_MAIN="${HAPI_ORIGIN_MAIN:-origin/main}"
TIP=""
JSON=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tip) TIP="${2:?}"; shift 2 ;;
        --json) JSON=1; shift ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ -z "$TIP" ]]; then
    if git -C "$DRIVER" rev-parse --verify HEAD >/dev/null 2>&1; then
        TIP="$(git -C "$DRIVER" rev-parse HEAD)"
    else
        echo "ERROR: no --tip and driver HEAD missing: $DRIVER" >&2
        exit 1
    fi
fi

git -C "$PRIMARY" fetch --quiet upstream 2>/dev/null || true
git -C "$PRIMARY" fetch --quiet origin 2>/dev/null || true

tip_short="$(git -C "$PRIMARY" rev-parse --short "$TIP")"
up_short="$(git -C "$PRIMARY" rev-parse --short "$UPSTREAM_REF")"
om_short="$(git -C "$PRIMARY" rev-parse --short "$ORIGIN_MAIN" 2>/dev/null || echo '?')"

# Commits on upstream not in tip (first-parent-ish full range).
mapfile -t MISSING_UP < <(git -C "$PRIMARY" log --oneline --no-merges "$TIP..$UPSTREAM_REF" 2>/dev/null | head -80)
mapfile -t MISSING_OM < <(git -C "$PRIMARY" log --oneline --no-merges "$TIP..$ORIGIN_MAIN" 2>/dev/null | head -80)

# Hot paths: files changed on upstream since tip, capped.
mapfile -t HOT < <(git -C "$PRIMARY" diff --name-only "$TIP...$UPSTREAM_REF" 2>/dev/null \
    | rg -e '^(web|hub|cli|shared)/src/' -e '^shared/src/' | head -60)

contains_origin=0
if git -C "$PRIMARY" merge-base --is-ancestor "$ORIGIN_MAIN" "$TIP" 2>/dev/null; then
    contains_origin=1
fi

if [[ "$JSON" -eq 1 ]]; then
    jq -n \
        --arg tip "$TIP" \
        --arg tip_short "$tip_short" \
        --arg upstream "$UPSTREAM_REF" \
        --arg up_short "$up_short" \
        --arg origin_main "$ORIGIN_MAIN" \
        --arg om_short "$om_short" \
        --argjson contains_origin "$contains_origin" \
        --argjson missing_up "$(printf '%s\n' "${MISSING_UP[@]-}" | jq -R . | jq -s .)" \
        --argjson missing_om "$(printf '%s\n' "${MISSING_OM[@]-}" | jq -R . | jq -s .)" \
        --argjson hot "$(printf '%s\n' "${HOT[@]-}" | jq -R . | jq -s .)" \
        '{tip:$tip, tip_short:$tip_short, upstream:$upstream, upstream_short:$up_short,
          origin_main:$origin_main, origin_main_short:$om_short,
          tip_contains_origin_main:($contains_origin==1),
          upstream_commits_not_in_tip:$missing_up,
          origin_main_commits_not_in_tip:$missing_om,
          hot_files_vs_upstream:$hot}'
    exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  REMAT UPSTREAM DRIFT"
echo "  tip:          $tip_short ($TIP)"
echo "  upstream:     $up_short ($UPSTREAM_REF)"
echo "  origin/main:  $om_short ($ORIGIN_MAIN)"
echo "  tip ⊇ origin/main: $([[ "$contains_origin" -eq 1 ]] && echo YES || echo NO)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Upstream commits not in tip (${#MISSING_UP[@]} shown, capped 80):"
if [[ "${#MISSING_UP[@]}" -eq 0 ]]; then
    echo "  (none)"
else
    printf '  %s\n' "${MISSING_UP[@]}"
fi
echo ""
echo "origin/main commits not in tip (${#MISSING_OM[@]} shown, capped 80):"
if [[ "${#MISSING_OM[@]}" -eq 0 ]]; then
    echo "  (none)"
else
    printf '  %s\n' "${MISSING_OM[@]}"
fi
echo ""
echo "Hot files tip...upstream (src only, capped 60):"
if [[ "${#HOT[@]}" -eq 0 ]]; then
    echo "  (none)"
else
    printf '  %s\n' "${HOT[@]}"
fi
echo ""
echo "Canon: tip-forward can leave soup behind fork main; run before/after remat."
echo "       Pair with operator-upstream-exclude.json require_together pins."
