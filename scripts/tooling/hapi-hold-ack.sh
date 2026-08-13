#!/usr/bin/env bash
# hapi-hold-ack — operator ack for 🛑 needs_operator / babysit.hold.
# Clears the latch so the next Meta run returns to live classify.
# Agent GitHub replies do NOT clear hold.
#
# Usage:
#   hapi-hold-ack 1108
#   hapi-hold-ack tiann/hapi#1108
#   hapi-hold-ack --repo heavygee/hapi 121
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib/pr-hold-core.sh
source "$SCRIPT_DIR/lib/pr-hold-core.sh"

STATE_FILE="${HAPI_META_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi/meta-daily.json}"
REPO="${HAPI_PR_REPO:-tiann/hapi}"
REPO_EXPLICIT=0
PR=""

err() { echo "hapi-hold-ack: $*" >&2; }
die() { err "$*"; exit 2; }

usage() {
    cat <<'EOF'
hapi-hold-ack — ack an operator-hold PR chip (🛑).

Usage:
  hapi-hold-ack <pr>
  hapi-hold-ack <owner/repo>#<pr>
  hapi-hold-ack --repo owner/repo <pr>

Does not ping the coding peer. Next hapi-meta-daily classifies live again.
Operator-only: requires a controlling tty (or HAPI_HOLD_ACK_ALLOW_NO_TTY=1 in tests).
Refuses HAPI_AGENT_CONTEXT=1 — coding peers cannot clear their own hold.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --repo) REPO="$2"; REPO_EXPLICIT=1; shift 2 ;;
        --state) STATE_FILE="$2"; shift 2 ;;
        *)
            if [[ "$1" == */*\#* ]]; then
                REPO="${1%%\#*}"
                PR="${1##*\#}"
                REPO_EXPLICIT=1
            elif [[ "$1" == *\#* ]]; then
                PR="${1##*\#}"
            else
                PR="$1"
            fi
            shift
            ;;
    esac
done

[[ -n "$PR" ]] || die "missing PR number (see --help)"
[[ "$PR" =~ ^[0-9]+$ ]] || die "PR must be a number (got: $PR)"

# Operator-only mutation. Coding peers must not clear the latch that stopped them
# (Codex P1 on #124). HAPI_AGENT_CONTEXT=1 is set for wrapped agents; tests set
# HAPI_HOLD_ACK_ALLOW_NO_TTY=1. Operator override still needs a real tty.
# shellcheck source=lib/operator-tty-gate.sh
source "$SCRIPT_DIR/lib/operator-tty-gate.sh"
if [[ "${HAPI_AGENT_CONTEXT:-}" == "1" && "${HAPI_HOLD_ACK_ALLOW_NO_TTY:-}" != "1" ]]; then
    die "refusing hold-ack from agent context (HAPI_AGENT_CONTEXT=1) — operator must ack from a real terminal"
fi
if ! caller_has_controlling_tty; then
    if [[ "${HAPI_HOLD_ACK_ALLOW_NO_TTY:-}" == "1" ]]; then
        :
    elif [[ "${HAPI_OPERATOR_HOLD_ACK_OVERRIDE:-}" == "1" ]]; then
        die "HAPI_OPERATOR_HOLD_ACK_OVERRIDE=1 ignored without controlling tty"
    else
        die "refusing hold-ack without controlling tty (operator-only; tests: HAPI_HOLD_ACK_ALLOW_NO_TTY=1)"
    fi
fi

# Serialize against hourly Meta (load→save can clobber an in-flight ack).
# Sibling of the state file so tests using --state $WORK/state.json do not
# contend with the live timer lock.
LOCK_FILE="${HAPI_META_LOCK:-$(dirname "$STATE_FILE")/meta-daily.lock}"
if [[ -z "${HAPI_HOLD_ACK_LOCKED:-}" ]]; then
    mkdir -p "$(dirname "$LOCK_FILE")"
    export HAPI_HOLD_ACK_LOCKED=1
    ack_args=(--state "$STATE_FILE" "$PR")
    [[ "$REPO_EXPLICIT" -eq 1 ]] && ack_args=(--repo "$REPO" "${ack_args[@]}")
    exec flock -w 60 "$LOCK_FILE" "$0" "${ack_args[@]}"
fi

[[ -f "$STATE_FILE" ]] || die "state file missing: $STATE_FILE (run hapi-meta-daily first)"

state="$(jq -c '.' "$STATE_FILE" 2>/dev/null || die "state is not valid JSON: $STATE_FILE")"

if [[ "$REPO_EXPLICIT" -eq 0 ]]; then
    # Bare number: unique hold row for that PR, preferring an unacked latch.
    # Multiple unacked (or multiple matching) rows for the same number must
    # not silently fall through to the default tiann/hapi and "succeed" while
    # the fork chip stays held.
    resolved="$(printf '%s' "$state" | jq -r --arg n "$PR" '
        (.hold // {})
        | to_entries
        | map(select(.key | endswith("#" + $n)))
        | . as $all
        | ($all | map(select(.value.acked == false))) as $unacked
        | if ($unacked | length) > 1 then
            "AMBIGUOUS\t" + ($unacked | map(.key) | join(", "))
          elif ($unacked | length) == 1 then
            $unacked[0].key
          elif ($all | length) > 1 then
            "AMBIGUOUS\t" + ($all | map(.key) | join(", "))
          elif ($all | length) == 1 then
            $all[0].key
          else
            empty
          end
    ')"
    if [[ "$resolved" == AMBIGUOUS$'\t'* ]]; then
        die "ambiguous hold for #$PR (${resolved#*$'\t'}) — pass --repo owner/repo"
    fi
    if [[ -n "$resolved" ]]; then
        REPO="${resolved%\#*}"
    fi
fi

key="$(pec_hold_state_key "$REPO" "$PR")"
if ! printf '%s' "$state" | jq -e --arg k "$key" '(.hold[$k] | type) == "object"' >/dev/null 2>&1; then
    die "no hold row for $key (pass --repo owner/repo if the number collides)"
fi

next="$(pec_hold_ack_state "$state" "$REPO" "$PR")"
tmp="$(mktemp "$(dirname "$STATE_FILE")/.hold-ack.XXXXXX")"
if ! printf '%s' "$next" | jq '.' >"$tmp"; then
    rm -f "$tmp"
    die "failed to serialize ack state for $key"
fi
if ! mv -f "$tmp" "$STATE_FILE"; then
    rm -f "$tmp"
    die "failed to persist ack state for $key"
fi
echo "hapi-hold-ack: acked $key — next Meta run returns to live classify"
