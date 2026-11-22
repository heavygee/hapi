#!/usr/bin/env bash
# hapi-kitchen-watchdog — drag the responsible seat back to a dirty kitchen.
#
# Why this exists (2026-11-22, operator): the tooling/meta seat held a remat
# escalation for 41+ hours across several sessions while answering "am I done?"
# from memory instead of from the affordance that already existed. A seat that
# can quietly end its turn with a dirty kitchen will, repeatedly. So the check
# stops being a judgement call and becomes a poll with a ping attached.
#
# hapi-kitchen-status is the single source of truth. This adds nothing to its
# verdict — it only decides WHO to wake and says so.
#
# Exit codes (mirrors hapi-kitchen-status so a timer can alert on them):
#   0   kitchen green, or busy (75) which is not a hygiene failure
#   1   kitchen dirty and the owning seat was pinged
#   2   kitchen dirty but no owner could be resolved (needs a human)
#
# Usage:
#   hapi-kitchen-watchdog              # evaluate and ping the owner if dirty
#   hapi-kitchen-watchdog --dry-run    # print the verdict and target, ping nobody
#
# Intended to run from a timer (see hapi-runner-watchdog.timer for the pattern)
# or from an agent-side cron. Safe to run concurrently — it only reads state and
# sends one message.
set -uo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
HOLD_FILE="${HAPI_REMAT_HOLD_FILE:-$HOME/.hapi/remat-hold.json}"
MANIFEST="$PRIMARY/config/meta-sessions.yaml"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run|-n) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) echo "Unknown flag: $1" >&2; exit 64 ;;
    esac
done

status_line="$(bash "$SCRIPT_DIR/hapi-kitchen-status.sh" --quiet 2>/dev/null || true)"
bash "$SCRIPT_DIR/hapi-kitchen-status.sh" --quiet >/dev/null 2>&1
rc=$?

case "$rc" in
    0)
        echo "kitchen-watchdog: green — nothing owed"
        exit 0
        ;;
    75)
        # A rebuild in flight is the kitchen being USED, not dirty. Nagging here
        # would train the seat to ignore the ping, which is how a watchdog dies.
        echo "kitchen-watchdog: busy (rebuild/switch in progress) — not a hygiene failure"
        exit 0
        ;;
esac

# Dirty. Prefer the seat that actually owns the escalation; fall back to the
# seat whose standing remit this is.
owner=""
owner_src=""
if [[ -r "$HOLD_FILE" ]]; then
    owner="$(python3 -c "
import json,sys
try:
    d=json.load(open('$HOLD_FILE'))
    print(d.get('owner_session_prefix') or '')
except Exception:
    print('')
" 2>/dev/null)"
    [[ -n "$owner" ]] && owner_src="remat hold owner"
fi
if [[ -z "$owner" && -r "$MANIFEST" ]]; then
    owner="$(python3 -c "
import re,sys
text=open('$MANIFEST').read()
m=re.search(r'^\s*tooling_meta:\s*$(.*?)(?=^\s*\w+:\s*$)', text, re.S|re.M)
block=m.group(1) if m else ''
s=re.search(r'session(?:_id)?:\s*([0-9a-fA-F-]{8,})', block)
print(s.group(1) if s else '')
" 2>/dev/null)"
    [[ -n "$owner" ]] && owner_src="meta-sessions.yaml tooling_meta"
fi

reason="exit $rc"
[[ "$rc" == "76" ]] && reason="remat escalation hold ACTIVE"
[[ "$rc" == "1" ]] && reason="mirror unclean / primary not on main"

msg="**Kitchen is DIRTY and you own it.** hapi-kitchen-status exits ${rc} (${reason}).

\`\`\`
${status_line}
\`\`\`

This is an automated poll, not a human asking. The seat's definition of done is
\`hapi-kitchen-status --quiet\` returning 0 (75 = busy is fine). Until it does,
there is work owed — either finish it, or hand the hold to someone who will and
say so explicitly.

If the hold is stale (the owning session is gone or the work was abandoned),
clear it rather than leaving the fleet blocked:
\`hapi-remat-hold status\` then clear as owner."

if [[ -z "$owner" ]]; then
    echo "kitchen-watchdog: DIRTY ($reason) but no owner resolved — needs a human" >&2
    echo "$status_line" >&2
    exit 2
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "kitchen-watchdog: DIRTY ($reason)"
    echo "  would ping: $owner  [$owner_src]"
    echo "  verdict:    $status_line"
    exit 1
fi

if command -v hapi-ping-peer >/dev/null 2>&1; then
    printf '%s' "$msg" | hapi-ping-peer "$owner" --message-file - --delivery-mode auto >/dev/null 2>&1 \
        || hapi-ping-peer "$owner" "$msg" >/dev/null 2>&1 \
        || { echo "kitchen-watchdog: ping to $owner FAILED" >&2; exit 2; }
    echo "kitchen-watchdog: DIRTY ($reason) — pinged $owner [$owner_src]"
    exit 1
fi

echo "kitchen-watchdog: DIRTY ($reason) but hapi-ping-peer is not on PATH" >&2
exit 2
