#!/usr/bin/env bash
# hapi-meta-sessions-audit — check config/meta-sessions.yaml against the live hub.
#
# The registry is hand-maintained alongside ~/.hapi/meta-daily.env and had zero
# code consumers (2026-11-08 triage finding), so nothing caught drift between
# the yaml, the env, and the sessions actually running. This is that auditor.
#
# Per `sessions:` entry:
#   A  live `id` resolves on the hub and its title == `name:`
#   B  `superseded:` id (if set) is gone (404), or titled "SUPERSEDED…"
#      — note *archived* is not gone: the hub still serves it by id, so an
#        archived husk must still be retitled to pass
#   C  `env:` var (if set) in the env file == `id`
#
# Usage:
#   hapi-meta-sessions-audit [--config FILE] [--env-file FILE]
#                            [--sessions-json FILE] [--quiet]
#
# --sessions-json swaps the hub fetch for a canned payload (tests, offline).
#
# Exit: 0 clean · 1 drift found · 2 usage/infra error.
set -euo pipefail

err() { echo "hapi-meta-sessions-audit: $*" >&2; }
die() { err "$*"; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$ROOT/config/meta-sessions.yaml"
ENV_FILE="${HAPI_META_ENV_FILE:-$HOME/.hapi/meta-daily.env}"
SESSIONS_JSON=""
QUIET=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config) CONFIG="$2"; shift 2 ;;
        --env-file) ENV_FILE="$2"; shift 2 ;;
        --sessions-json) SESSIONS_JSON="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
        *) die "unexpected arg: $1" ;;
    esac
done

command -v yq >/dev/null || die "yq not on PATH"
command -v jq >/dev/null || die "jq not on PATH"
[[ -f "$CONFIG" ]] || die "config not found: $CONFIG"

if [[ -n "$SESSIONS_JSON" ]]; then
    MODE="json"
    [[ -f "$SESSIONS_JSON" ]] || die "sessions json not found: $SESSIONS_JSON"
    SESSIONS="$(cat "$SESSIONS_JSON")"
    jq -e '.sessions | type == "array"' <<<"$SESSIONS" >/dev/null 2>&1 \
        || die "unexpected sessions payload (no .sessions array)"
else
    MODE="hub"
    HAPI_HOST="${HAPI_HOST:-http://localhost:3006}"
    SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
    [[ -f "$SETTINGS" ]] || die "settings file not found: $SETTINGS"
    RAW_TOKEN="$(jq -r '.cliApiToken // empty' "$SETTINGS")"
    [[ -n "$RAW_TOKEN" ]] || die "no cliApiToken in $SETTINGS (run 'hapi auth login')"
    JWT="$(curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg t "$RAW_TOKEN:default" '{accessToken:$t}')" \
        "$HAPI_HOST/api/auth" | jq -r '.token // empty')"
    [[ -n "$JWT" ]] || die "failed to exchange access token for JWT (is $HAPI_HOST reachable?)"
fi

# Resolve one id: prints its title, exit 0 present / 1 absent.
#
# Deliberately per-id, NOT a scan of GET /api/sessions?limit=N. The hub caps
# that page at 500 rows server-side (`?limit=2000` also returns 500) and
# ignores `offset`, so "missing from the page" only means "not in the ~22 most
# recent days". Superseded husks stop updating the moment they are retired, so
# they age out of that window *faster* than their live counterpart — a page
# scan would decay toward false-clean on exactly the check that exists to catch
# a husk still wearing a live title. Verified 2026-11-08: archived 403411de is
# absent from `?limit=2000` yet returns 200 here; a nonexistent id returns 404.
resolve() {
    local id="$1"
    if [[ "$MODE" == "json" ]]; then
        # A canned payload is the complete universe by construction.
        local n
        n="$(jq -r --arg id "$id" '[.sessions[] | select(.id == $id)] | length' <<<"$SESSIONS")"
        [[ "$n" != "0" ]] || return 1
        jq -r --arg id "$id" '.sessions[] | select(.id == $id) | (.metadata.name // "")' <<<"$SESSIONS"
        return 0
    fi
    local tmp code
    tmp="$(mktemp "${TMPDIR:-/tmp}/hapi-meta-audit.XXXXXX")"
    code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 10 \
        -H "Authorization: Bearer $JWT" "$HAPI_HOST/api/sessions/$id" || echo 000)"
    case "$code" in
        200) jq -r '.session.metadata.name // ""' "$tmp"; rm -f "$tmp"; return 0 ;;
        404) rm -f "$tmp"; return 1 ;;
        *)   rm -f "$tmp"; die "GET /api/sessions/${id:0:8}… → HTTP $code" ;;
    esac
}

FAIL=0
say() { [[ "$QUIET" == "1" ]] || echo "$*"; }
report_fail() { FAIL=$((FAIL+1)); echo "DRIFT: $*" >&2; }

while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    name="$(yq -r ".sessions.\"$key\".name // \"\"" "$CONFIG")"
    id="$(yq -r ".sessions.\"$key\".id // \"\"" "$CONFIG")"
    sup="$(yq -r ".sessions.\"$key\".superseded // \"\"" "$CONFIG")"
    envvar="$(yq -r ".sessions.\"$key\".env // \"\"" "$CONFIG")"

    [[ -n "$id" ]] || { report_fail "$key: no id in registry"; continue; }

    # A — live session wears the registry title
    if ! live_title="$(resolve "$id")"; then
        report_fail "$key: live id ${id:0:8}… not found on hub (404)"
    elif [[ "$live_title" != "$name" ]]; then
        report_fail "$key: live title \"$live_title\" != registry name \"$name\""
    else
        say "ok   $key: live ${id:0:8}… titled \"$name\""
    fi

    # B — husk is archived, or at least visibly SUPERSEDED
    if [[ -n "$sup" ]]; then
        if ! sup_title="$(resolve "$sup")"; then
            say "ok   $key: superseded ${sup:0:8}… absent from hub (404 — deleted)"
        elif [[ "$sup_title" == SUPERSEDED* ]]; then
            say "ok   $key: superseded ${sup:0:8}… marked SUPERSEDED"
        else
            report_fail "$key: superseded ${sup:0:8}… still titled \"$sup_title\" — collides with live"
        fi
    fi

    # C — env pointer agrees with the registry.
    # Not every specialist routes through meta-daily.env: issue labelling has
    # its own ~/.hapi/issue-labelling.env read by hapi-issue-labelling-daily.sh,
    # so an entry may name its own file. Default stays meta-daily.env.
    if [[ -n "$envvar" ]]; then
        entry_env="$(yq -r ".sessions.\"$key\".env_file // \"\"" "$CONFIG")"
        entry_env="${entry_env/#\~\//$HOME/}"
        [[ -n "$entry_env" ]] || entry_env="$ENV_FILE"
        if [[ ! -f "$entry_env" ]]; then
            report_fail "$key: env file not found: $entry_env"
        else
            env_val="$(sed -n "s/^${envvar}=//p" "$entry_env" | tail -1)"
            if [[ -z "$env_val" ]]; then
                report_fail "$key: $envvar unset in $entry_env"
            elif [[ "$env_val" != "$id" ]]; then
                report_fail "$key: $envvar=${env_val:0:8}… != registry ${id:0:8}…"
            else
                say "ok   $key: $envvar agrees with registry"
            fi
        fi
    fi
done < <(yq -r '.sessions | keys | .[]' "$CONFIG")

if [[ "$FAIL" -gt 0 ]]; then
    err "$FAIL drift finding(s)"
    exit 1
fi
say "meta-sessions registry clean"
exit 0
