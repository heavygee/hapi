#!/usr/bin/env bash
# hapi-laneb-authorise — operator grants a single-use lane B merge authorisation.
#
# Deliberately REFUSES to run from an agent shell. A lane B merge is an operator
# decision made by a human with a TTY (docs/operator/AGENTS.md § Upstream
# relationship). An agent asking for the merge must ask the operator to run this.
#
# The grant is bound to ONE pr number AND ONE head SHA, expires, and is consumed
# by hapi-pr-merge-gate.sh on use — so it cannot authorise a later push.
#
# Usage:  hapi-laneb-authorise <pr-number> [head-sha] [--ttl-min N]

set -euo pipefail

REAL_GH="${HAPI_REAL_GH:-/usr/bin/gh}"
UPSTREAM_REPO="${HAPI_UPSTREAM_REPO:-tiann/hapi}"
TOKDIR="${HAPI_LANEB_DIR:-$HOME/.config/hapi/laneb}"
TTL_MIN=30

PR="${1:-}"; shift || true
HEAD="${1:-}"; [ "${HEAD:0:2}" = "--" ] && HEAD=""
[ -n "$HEAD" ] && shift || true
while [ $# -gt 0 ]; do
    case "$1" in --ttl-min) TTL_MIN="${2:-30}"; shift 2 ;; *) shift ;; esac
done

[ -n "$PR" ] || { echo "usage: hapi-laneb-authorise <pr-number> [head-sha] [--ttl-min N]" >&2; exit 64; }

caller_has_controlling_tty() {
    local stat_line tty_nr
    [ -r "/proc/$PPID/stat" ] || return 1
    stat_line="$(cat "/proc/$PPID/stat" 2>/dev/null)" || return 1
    tty_nr=$(printf '%s' "$stat_line" | sed 's/.*) //' | awk '{print $5}')
    [ -n "$tty_nr" ] && [ "$tty_nr" != "0" ]
}

if [ -n "${CLAUDECODE:-}" ] || [ -n "${CURSOR_AGENT_SESSION_ID:-}" ] \
   || [ "${CURSOR_AGENT:-}" = "1" ] || [ "${HAPI_AGENT_CONTEXT:-}" = "1" ] \
   || [ "${CI:-}" = "true" ] || ! caller_has_controlling_tty; then
    cat >&2 <<'MSG'
REFUSE: lane B authorisation must be granted by an operator on a real TTY.

Agents are prepare-only on upstream. Ask the operator to run, in their own shell:
    hapi-laneb-authorise <pr-number>

There is intentionally no env-var bypass. This is the one gate an agent cannot
self-serve — see docs/operator/AGENTS.md § Upstream relationship.
MSG
    exit 2
fi

if [ -z "$HEAD" ]; then
    HEAD="$("$REAL_GH" pr view "$PR" --repo "$UPSTREAM_REPO" --json headRefOid -q .headRefOid 2>/dev/null || true)"
fi
[ -n "$HEAD" ] || { echo "ERROR: cannot resolve head SHA for $UPSTREAM_REPO#$PR" >&2; exit 65; }

TITLE="$("$REAL_GH" pr view "$PR" --repo "$UPSTREAM_REPO" --json title -q .title 2>/dev/null || echo '?')"

echo "Lane B authorisation"
echo "  repo:  $UPSTREAM_REPO"
echo "  pr:    #$PR — $TITLE"
echo "  head:  $HEAD"
echo "  ttl:   ${TTL_MIN} min, single use"
echo
echo "This permits ONE merge of this exact SHA. The pre-merge gate still runs and"
echo "can still block (unresolved threads, unanswered maintainer comments, red CI)."
printf 'Type MERGE to authorise: '
read -r ans
[ "$ans" = "MERGE" ] || { echo "Aborted."; exit 1; }

mkdir -p "$TOKDIR"
umask 077
{
    echo "pr=$PR"
    echo "repo=$UPSTREAM_REPO"
    echo "head=$HEAD"
    echo "granted=$(date -u +%s)"
    echo "expires=$(( $(date -u +%s) + TTL_MIN * 60 ))"
    echo "by=$(id -un)@$(hostname)"
} > "$TOKDIR/$PR.auth"

echo "Authorised. Agent may now run the merge; the gate will consume this grant."
