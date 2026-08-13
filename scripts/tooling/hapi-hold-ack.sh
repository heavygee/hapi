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

# Capture the live Meta state path before --state can redirect it. No-TTY
# test bypasses must never apply to this path (Codex P1 on #124).
LIVE_STATE_FILE="${HAPI_META_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi/meta-daily.json}"
STATE_FILE="$LIVE_STATE_FILE"
REPO="${HAPI_PR_REPO:-tiann/hapi}"
REPO_EXPLICIT=0
PR=""

err() { echo "hapi-hold-ack: $*" >&2; }
die() { err "$*"; exit 2; }

# Canonical absolute path (symlinks resolved) for live-vs-redirect compare.
hold_ack_abs_path() {
    local p="$1" dir base
    if command -v realpath >/dev/null 2>&1; then
        realpath -m -- "$p" 2>/dev/null && return 0
    fi
    if [[ -e "$p" ]]; then
        readlink -f -- "$p"
        return 0
    fi
    dir=$(dirname -- "$p")
    base=$(basename -- "$p")
    if [[ -d "$dir" ]]; then
        printf '%s/%s\n' "$(cd -- "$dir" && pwd -P)" "$base"
    else
        printf '%s\n' "$p"
    fi
}

# Test-only no-TTY gate: env alone is forgeable (env -u HAPI_AGENT_CONTEXT
# HAPI_HOLD_ACK_ALLOW_NO_TTY=1). Require (1) redirected --state that is not
# the live Meta file and (2) a sidecar cookie written by the harness next to
# that state. Clearing a temp fixture cannot clear the production latch.
hold_ack_test_no_tty_ok() {
    [[ "${HAPI_HOLD_ACK_ALLOW_NO_TTY:-}" == "1" ]] || return 1
    local live candidate cookie
    live="$(hold_ack_abs_path "$LIVE_STATE_FILE")"
    candidate="$(hold_ack_abs_path "$STATE_FILE")"
    [[ -n "$live" && -n "$candidate" && "$live" != "$candidate" ]] || return 1
    cookie="${STATE_FILE}.hold-ack-test"
    [[ -f "$cookie" ]] || return 1
    [[ "$(cat "$cookie" 2>/dev/null || true)" == "$candidate" ]]
}

usage() {
    cat <<'EOF'
hapi-hold-ack — ack an operator-hold PR chip (🛑).

Usage:
  hapi-hold-ack <pr>
  hapi-hold-ack <owner/repo>#<pr>
  hapi-hold-ack --repo owner/repo <pr>

Does not ping the coding peer. Next hapi-meta-daily classifies live again.
Operator-only: requires a controlling tty. Tests may use redirected --state
plus a sibling .hold-ack-test cookie (see hapi-meta-daily.test.sh); env alone
never clears the live Meta latch.
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
# (Codex P1 on #124). HAPI_AGENT_CONTEXT=1 is refused unconditionally.
# No-TTY: only the harness path (non-live --state + sidecar cookie + ALLOW_NO_TTY).
# Env alone is forgeable and must not clear the live Meta latch.
# shellcheck source=lib/operator-tty-gate.sh
source "$SCRIPT_DIR/lib/operator-tty-gate.sh"
if [[ "${HAPI_AGENT_CONTEXT:-}" == "1" ]]; then
    die "refusing hold-ack from agent context (HAPI_AGENT_CONTEXT=1) — operator must ack from a real terminal"
fi
if ! caller_has_controlling_tty; then
    if hold_ack_test_no_tty_ok; then
        :
    elif [[ "${HAPI_OPERATOR_HOLD_ACK_OVERRIDE:-}" == "1" ]]; then
        die "HAPI_OPERATOR_HOLD_ACK_OVERRIDE=1 ignored without controlling tty"
    elif [[ "${HAPI_HOLD_ACK_ALLOW_NO_TTY:-}" == "1" ]]; then
        die "refusing hold-ack without controlling tty (ALLOW_NO_TTY needs non-live --state + .hold-ack-test cookie)"
    else
        die "refusing hold-ack without controlling tty (operator-only)"
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
