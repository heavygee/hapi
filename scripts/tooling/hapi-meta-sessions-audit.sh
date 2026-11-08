#!/usr/bin/env bash
# hapi-meta-sessions-audit — check config/meta-sessions.yaml against the live hub.
#
# The registry is hand-maintained alongside ~/.hapi/meta-daily.env and had zero
# code consumers (2026-11-08 triage finding), so nothing caught drift between
# the yaml, the env, and the sessions actually running. This is that auditor.
#
# Per `sessions:` entry:
#   A  live `id` resolves on the hub and its title == `name:`
#   B  `superseded:` id (if set) is absent, or titled "SUPERSEDED…"
#      — absent counts as pass: an archived husk cannot be mistaken for live
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
    [[ -f "$SESSIONS_JSON" ]] || die "sessions json not found: $SESSIONS_JSON"
    SESSIONS="$(cat "$SESSIONS_JSON")"
else
    HAPI_HOST="${HAPI_HOST:-http://localhost:3006}"
    SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
    [[ -f "$SETTINGS" ]] || die "settings file not found: $SETTINGS"
    RAW_TOKEN="$(jq -r '.cliApiToken // empty' "$SETTINGS")"
    [[ -n "$RAW_TOKEN" ]] || die "no cliApiToken in $SETTINGS (run 'hapi auth login')"
    JWT="$(curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
        -d "$(jq -cn --arg t "$RAW_TOKEN:default" '{accessToken:$t}')" \
        "$HAPI_HOST/api/auth" | jq -r '.token // empty')"
    [[ -n "$JWT" ]] || die "failed to exchange access token for JWT (is $HAPI_HOST reachable?)"
    SESSIONS="$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" \
        "$HAPI_HOST/api/sessions?limit=500")"
fi

jq -e '.sessions | type == "array"' <<<"$SESSIONS" >/dev/null 2>&1 \
    || die "unexpected sessions payload (no .sessions array)"

# id -> title lookup; empty output means "no such session on the hub"
title_of() {
    jq -r --arg id "$1" \
        '.sessions[] | select(.id == $id) | (.metadata.name // "") ' <<<"$SESSIONS"
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
    live_title="$(title_of "$id")"
    if [[ -z "$live_title" ]]; then
        report_fail "$key: live id ${id:0:8}… not found on hub"
    elif [[ "$live_title" != "$name" ]]; then
        report_fail "$key: live title \"$live_title\" != registry name \"$name\""
    else
        say "ok   $key: live ${id:0:8}… titled \"$name\""
    fi

    # B — husk is archived, or at least visibly SUPERSEDED
    if [[ -n "$sup" ]]; then
        sup_title="$(title_of "$sup")"
        if [[ -z "$sup_title" ]]; then
            say "ok   $key: superseded ${sup:0:8}… absent from hub (archived)"
        elif [[ "$sup_title" == SUPERSEDED* ]]; then
            say "ok   $key: superseded ${sup:0:8}… marked SUPERSEDED"
        else
            report_fail "$key: superseded ${sup:0:8}… still titled \"$sup_title\" — collides with live"
        fi
    fi

    # C — env pointer agrees with the registry
    if [[ -n "$envvar" ]]; then
        if [[ ! -f "$ENV_FILE" ]]; then
            report_fail "$key: env file not found: $ENV_FILE"
        else
            env_val="$(sed -n "s/^${envvar}=//p" "$ENV_FILE" | tail -1)"
            if [[ -z "$env_val" ]]; then
                report_fail "$key: $envvar unset in $ENV_FILE"
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
