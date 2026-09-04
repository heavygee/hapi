#!/usr/bin/env bash
# hapi-claude-reopen-fleet.sh — reopen inactive Claude fleet rows via hub API.
#
# Inactive rows (after auth swap) need POST /reopen, not direct rebind on the
# old id. Reopen spawns a merged row (may get a new session id) with live CLI.
#
# Usage: hapi-claude-reopen-fleet.sh [--dry-run]
set -euo pipefail
export PATH="/usr/bin:/bin:${PATH:-}"

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
WAIT_SECS="${HAPI_REOPEN_WAIT_SECS:-60}"

CLI_TOKEN="$(jq -r '.cliApiToken' "$SETTINGS")"
JWT="$(curl -sS --max-time 10 -X POST "$HAPI_HOST/api/auth" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$CLI_TOKEN:default" '{accessToken:$t}')" | jq -r '.token')"
[[ -n "$JWT" && "$JWT" != null ]] || { echo "JWT exchange failed" >&2; exit 2; }

# Inactive fleet rows from auth-swap (prefix, label)
FLEET=(
    "f5d8aa10|Overseer stand-in"
    "9d6a8cfb|Peer #1717 blocked list UX"
    "b278452d|Arthur Scout lecturing"
    "5fa8233c|Arthur scout btp+icrir"
    "8f1d65c3|Peer fork main vs soup"
    "7e6d4da5|Antevorta setup"
    "bcc91b49|Tracking work board"
    "92909d7e|GitHub Actions runner audit"
    "4ba19a02|PutOut coverage"
)

resolve_sid() {
    local prefix="$1"
    curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions?limit=500" \
        | jq -r --arg p "$prefix" '(.sessions // [])[] | select(.id | startswith($p)) | .id' | head -1
}

ok=0
fail=0
declare -a MIGRATIONS=()

for entry in "${FLEET[@]}"; do
    prefix="${entry%%|*}"
    label="${entry#*|}"
    sid="$(resolve_sid "$prefix")"
    [[ -n "$sid" ]] || { echo "SKIP $prefix — not found"; fail=$((fail+1)); continue; }

    state="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$sid" \
        | jq -r '.session | "\(.active)|\(.metadata.hostPid // "")"')"
    active="${state%%|*}"
    hp="${state#*|}"
    if [[ "$active" == "true" && -n "$hp" && -d "/proc/$hp" ]]; then
        echo "OK $prefix already live pid=$hp ($label)"
        ok=$((ok+1))
        continue
    fi

    if [[ "$DRY" -eq 1 ]]; then
        echo "WOULD reopen $prefix ($sid) $label"
        continue
    fi

    echo "-- reopen ${prefix} $label --"
    resp="$(curl -sS --max-time 120 -X POST -H "Authorization: Bearer $JWT" \
        -H 'Content-Type: application/json' -d '{}' "$HAPI_HOST/api/sessions/$sid/reopen")"
    new_sid="$(echo "$resp" | jq -r '.sessionId // empty')"
    if [[ -z "$new_sid" ]]; then
        echo "   FAIL: $resp"
        fail=$((fail+1))
        continue
    fi
    [[ "$new_sid" != "$sid" ]] && MIGRATIONS+=("$prefix -> ${new_sid:0:8}")

    end=$(( $(date +%s) + WAIT_SECS ))
    bound=0
    while [[ $(date +%s) -lt $end ]]; do
        hp="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$new_sid" \
            | jq -r '.session.metadata.hostPid // empty')"
        act="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$new_sid" \
            | jq -r '.session.active // false')"
        if [[ "$act" == "true" && -n "$hp" && -d "/proc/$hp" ]]; then
            bound=1
            break
        fi
        /bin/sleep 2
    done

    if [[ "$bound" -eq 1 ]]; then
        echo "   OK ${new_sid:0:8} pid=$hp"
        ok=$((ok+1))
    else
        echo "   FAIL not bound within ${WAIT_SECS}s"
        fail=$((fail+1))
    fi
    /bin/sleep 2
done

if [[ ${#MIGRATIONS[@]} -gt 0 ]]; then
    echo ""
    echo "Session id migrations (bookmarks):"
    printf '  %s\n' "${MIGRATIONS[@]}"
fi
echo "== reopen fleet: ok=$ok fail=$fail =="
