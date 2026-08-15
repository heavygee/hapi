#!/usr/bin/env bash
# hapi-kitchen-status — one-line kitchen / soup hygiene snapshot (fork tooling).
#
# Aggregates driver coordination, remat hold/lease, mirror porcelain, and fork
# sync so agents (especially tooling meta-bot) can answer "how clean is the
# kitchen?" without shelling five commands.
#
# Usage:
#   hapi-kitchen-status              # human one-liner + detail block
#   hapi-kitchen-status --quiet      # one line only (for session titles / pings)
#   hapi-kitchen-status --json       # machine-readable object
#
# Exit codes (kitchen health, not driver busy):
#   0   green (idle, no hold, mirror clean enough for sync/rebuild)
#   1   mirror porcelain blocks sync/rebuild (tracked dirt on primary)
#   76  remat-hold active
#   75  driver rebuild/switch busy (informational — not a hygiene fail)

set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
MODE=human

while [[ $# -gt 0 ]]; do
    case "$1" in
    --json) MODE=json; shift ;;
    --quiet|-q) MODE=quiet; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }

driver_q=0
driver_busy=0
if ! bash "$SCRIPT_DIR/hapi-driver-status.sh" --quiet 2>/dev/null; then
    driver_q=$?
    driver_busy=1
fi

hold_active=0
hold_reason=""
if bash "$SCRIPT_DIR/hapi-remat-hold.sh" check 2>/dev/null; then
    :
else
    hold_active=1
    hold_reason="$(jq -r '.reason // "?"' "$HOME/.hapi/remat-hold.json" 2>/dev/null || echo "?")"
fi

driver_head="?"
driver_layers="?"
if git -C "$DRIVER" rev-parse --short HEAD >/dev/null 2>&1; then
    driver_head="$(git -C "$DRIVER" rev-parse --short HEAD)"
fi
if [[ -f "$PRIMARY/config/driver-manifest.yaml" ]]; then
    driver_layers="$(grep -c '^  - branch:' "$PRIMARY/config/driver-manifest.yaml" 2>/dev/null || echo "?")"
fi

mirror_dirty=0
mirror_note="clean"
if [[ -d "$PRIMARY/.git" ]]; then
    porcelain="$(git -C "$PRIMARY" status --porcelain --untracked-files=no 2>/dev/null || true)"
    if [[ -n "$porcelain" ]]; then
        mirror_dirty=1
        mirror_note="dirty ($(echo "$porcelain" | wc -l | tr -d ' ') tracked)"
    fi
    untracked="$(git -C "$PRIMARY" status --porcelain --untracked-files=all 2>/dev/null | grep '^??' | wc -l | tr -d ' ')"
    if [[ "$untracked" -gt 0 && "$mirror_dirty" -eq 0 ]]; then
        mirror_note="clean (+${untracked} untracked)"
    fi
fi

fork_behind=0 fork_ahead=0
if git -C "$PRIMARY" rev-parse upstream/main >/dev/null 2>&1; then
    read -r fork_behind fork_ahead < <(git -C "$PRIMARY" rev-list --left-right --count upstream/main...main 2>/dev/null || echo "0 0")
fi

working="?"
ws="$(bash "$SCRIPT_DIR/hapi-driver-status.sh" 2>/dev/null | grep -oE 'WORKING=[0-9]+' | head -1 || true)"
[[ -n "$ws" ]] && working="${ws#WORKING=}"

lease_holder=""
if [[ -f "$HOME/.hapi/remat-lease.json" ]]; then
    lease_holder="$(jq -r '.session // empty' "$HOME/.hapi/remat-lease.json" 2>/dev/null | cut -c1-8)"
fi
lease_note="unheld"
[[ -n "$lease_holder" ]] && lease_note="held ${lease_holder}"

rule_chopped=0
rule_path="$PRIMARY/.cursor/rules/hapi-session.mdc"
if [[ -f "$rule_path" ]] && ! grep -q 'Operator-facing session identity' "$rule_path" 2>/dev/null; then
    rule_chopped=1
fi

exit_code=0
if [[ "$hold_active" -eq 1 ]]; then
    exit_code=76
elif [[ "$mirror_dirty" -eq 1 ]]; then
    exit_code=1
fi

status_word=green
[[ "$hold_active" -eq 1 ]] && status_word=hold
[[ "$mirror_dirty" -eq 1 ]] && status_word=dirty
[[ "$driver_busy" -eq 1 && "$status_word" == green ]] && status_word=busy
[[ "$rule_chopped" -eq 1 ]] && status_word="${status_word}+rule-chop"

oneliner="kitchen: ${status_word} | driver ${driver_head} (${driver_layers} layers) | mirror ${mirror_note} | fork +${fork_ahead}/-${fork_behind} | WORKING=${working} | remat-hold=$([[ $hold_active -eq 0 ]] && echo off || echo "$hold_reason") | lease ${lease_note}"

case "$MODE" in
json)
    # driverLayers must stay valid JSON for --argjson even when the manifest
    # is missing or grep found nothing countable (driver_layers="?" then).
    driver_layers_json="$driver_layers"
    [[ "$driver_layers_json" =~ ^[0-9]+$ ]] || driver_layers_json=0
    jq -n \
        --arg status "$status_word" \
        --arg driverHead "$driver_head" \
        --argjson driverLayers "$driver_layers_json" \
        --arg mirror "$mirror_note" \
        --argjson mirrorDirty "$mirror_dirty" \
        --argjson forkAhead "$fork_ahead" \
        --argjson forkBehind "$fork_behind" \
        --arg working "$working" \
        --argjson holdActive "$hold_active" \
        --arg holdReason "$hold_reason" \
        --arg lease "$lease_note" \
        --argjson driverBusy "$driver_busy" \
        --argjson ruleChopped "$rule_chopped" \
        --arg oneliner "$oneliner" \
        '{status: $status, driverHead: $driverHead, driverLayers: $driverLayers, mirror: $mirror, mirrorDirty: ($mirrorDirty == 1), forkAhead: $forkAhead, forkBehind: $forkBehind, working: $working, holdActive: ($holdActive == 1), holdReason: $holdReason, lease: $lease, driverBusy: ($driverBusy == 1), ruleChopped: ($ruleChopped == 1), oneliner: $oneliner}'
    ;;
quiet)
    echo "$oneliner"
    ;;
human)
    echo "$oneliner"
    echo ""
    echo "Detail: hapi-driver-status | hapi-remat-hold status | git -C $PRIMARY status -sb"
    [[ "$rule_chopped" -eq 1 ]] && echo "WARN: hapi-session.mdc missing identity section (overlay chop?) — git checkout -- .cursor/rules/hapi-session.mdc"
    ;;
esac

exit "$exit_code"
