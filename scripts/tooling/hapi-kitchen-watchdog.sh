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
# CADENCE (predecessor review, 2026-11-22): a flat ping every 20min against a
# legitimately long hold is ~120 identical fires over 41 hours, which becomes
# wallpaper — "if you leave flat :07/:27/:47 forever, the fix is already dying;
# you just have not felt the numbness yet." So:
#   * exit 76 during an OWNED hold is expected, not always an emergency
#   * age escalation instead of flat poll: T+0, then ~2h / 8h / 24h
#   * at >=24h the OPERATOR is pinged too — owner-only forever is how 41 hours
#     passes without a human smelling it
#   * state change (hold reason or remaining-conflict count moved) resets the
#     ladder, because that is progress and deserves silence
# State lives in ~/.local/state/hapi/kitchen-watchdog.state
#
# Reproducible check on the ladder (it was wrong once, in the direction of
# nagging the owner about their own progress reports):
#   S=$(mktemp -d)
#   r() { HAPI_KITCHEN_WATCHDOG_STATE_DIR="$S" bash hapi-kitchen-watchdog.sh --dry-run | tail -1; }
#   r   # 1st: no prior state  -> announces
#   r   # 2nd: unchanged       -> "unchanged ... staying quiet"
#   <change the hold reason>
#   r   # 3rd: state moved     -> "state MOVED ... staying quiet"
#   r   # 4th: unchanged       -> quiet again
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
        -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
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
import re
text=open('$MANIFEST').read()
m=re.search(r'^  tooling_meta:\s*$', text, re.M)
block=text[m.end():] if m else ''
n=re.search(r'^  \w+:\s*$', block, re.M)
block=block[:n.start()] if n else block
# key is 'id:', not 'session:' — the earlier regex matched nothing and the
# fallback silently never fired (masked by the hold file resolving first).
k=re.search(r'^\s*id:\s*([0-9a-fA-F-]{8,})', block, re.M)
print(k.group(1) if k else '')
" 2>/dev/null)"
    [[ -n "$owner" ]] && owner_src="meta-sessions.yaml tooling_meta"
fi

reason="exit $rc"
[[ "$rc" == "76" ]] && reason="remat escalation hold ACTIVE"
[[ "$rc" == "1" ]] && reason="mirror unclean / primary not on main"

# ---- age escalation ------------------------------------------------------
# Fire at T+0, then only when the hold crosses 2h / 8h / 24h, unless the state
# fingerprint changed (progress => stay quiet and reset the ladder).
STATE_DIR="${HAPI_KITCHEN_WATCHDOG_STATE_DIR:-$HOME/.local/state/hapi}"
STATE_FILE="$STATE_DIR/kitchen-watchdog.state"
mkdir -p "$STATE_DIR" 2>/dev/null || true

hold_set_at=""
if [[ -r "$HOLD_FILE" ]]; then
    hold_set_at="$(python3 -c "
import json
try: print(json.load(open('$HOLD_FILE')).get('set_at') or '')
except Exception: print('')
" 2>/dev/null)"
fi
age_h=0
if [[ -n "$hold_set_at" ]]; then
    age_h="$(python3 -c "
import datetime
try:
    t=datetime.datetime.fromisoformat('$hold_set_at'.replace('Z','+00:00'))
    now=datetime.datetime.now(datetime.timezone.utc)
    print(int((now-t).total_seconds()//3600))
except Exception: print(0)
" 2>/dev/null)"
fi

# Fingerprint: anything that means real movement. Remaining-conflict count is
# the honest progress signal; the hold reason catches a different failure.
remaining="?"
remat_wt="$(python3 -c "
import json
try: print(json.load(open('$HOLD_FILE')).get('remat_wt') or '')
except Exception: print('')
" 2>/dev/null)"
if [[ -n "$remat_wt" && -d "$remat_wt" ]]; then
    remaining="$(git -C "$remat_wt" diff --name-only --diff-filter=U 2>/dev/null | wc -l | tr -d ' ')"
fi
# Include the hold's OWN reason, not just the one derived from the exit code:
# a different failure behind the same code deserves a fresh ping, which is what
# "state change resets the ladder" has to mean.
hold_reason=""
if [[ -r "$HOLD_FILE" ]]; then
    hold_reason="$(python3 -c "
import json
try: print((json.load(open('$HOLD_FILE')).get('reason') or '').strip())
except Exception: print('')
" 2>/dev/null)"
fi
fingerprint="rc=$rc|reason=$reason|hold=$hold_reason|remaining=$remaining"

prev_fingerprint=""; prev_rung=""
if [[ -r "$STATE_FILE" ]]; then
    prev_fingerprint="$(sed -n '1p' "$STATE_FILE")"
    prev_rung="$(sed -n '2p' "$STATE_FILE")"
fi

rung=0
for threshold in 2 8 24; do
    [[ "$age_h" -ge "$threshold" ]] && rung=$threshold
done

notify_operator=0
should_ping=0
if [[ -z "$prev_fingerprint" ]]; then
    # First time this dirty state is seen at all — say so once.
    should_ping=1
elif [[ "$fingerprint" != "$prev_fingerprint" ]]; then
    # State MOVED. The header says progress deserves silence, and the first
    # implementation then pinged on every change anyway — which turned the
    # owner's own progress reports into a nag loop: each time the hold reason
    # was updated with fresh numbers the fingerprint changed and this fired,
    # three times in one working session, every one of them telling the owner
    # something they had just written themselves.
    #
    # So movement resets the ladder and stays QUIET. The ladder below is what
    # breaks silence, and a hold that is genuinely progressing re-earns its
    # quiet every time it moves.
    should_ping=0
elif [[ "$rung" != "$prev_rung" ]]; then
    # Age crossed 2h / 8h / 24h with NOTHING having moved. That is the signal.
    should_ping=1
    [[ "$rung" -ge 24 ]] && notify_operator=1
fi

printf '%s\n%s\n' "$fingerprint" "$rung" > "$STATE_FILE" 2>/dev/null || true

if [[ "$should_ping" -eq 0 ]]; then
    if [[ "$fingerprint" != "$prev_fingerprint" ]]; then
        echo "kitchen-watchdog: DIRTY ($reason) age=${age_h}h remaining=$remaining — state MOVED since the last check, ladder reset, staying quiet"
    else
        echo "kitchen-watchdog: DIRTY ($reason) age=${age_h}h remaining=$remaining — unchanged, already escalated at rung ${prev_rung}h, staying quiet"
    fi
    exit 1
fi

msg="**Kitchen is DIRTY and you own it.** hapi-kitchen-status exits ${rc} (${reason}). Hold age **${age_h}h**, unresolved conflicts **${remaining}**.

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

send_ping() {
    local target="$1" body="$2"
    printf '%s' "$body" | hapi-ping-peer "$target" --message-file - --delivery-mode auto >/dev/null 2>&1 \
        || hapi-ping-peer "$target" "$body" >/dev/null 2>&1
}

if command -v hapi-ping-peer >/dev/null 2>&1; then
    send_ping "$owner" "$msg" \
        || { echo "kitchen-watchdog: ping to $owner FAILED" >&2; exit 2; }
    echo "kitchen-watchdog: DIRTY ($reason) age=${age_h}h remaining=$remaining rung=${rung}h — pinged $owner [$owner_src]"

    # Owner-only forever is how 41 hours passes without a human smelling it.
    # At the 24h rung, escalate to the seat that reports to the operator.
    if [[ "$notify_operator" -eq 1 ]]; then
        escalate="$(python3 -c "
import re
text=open('$MANIFEST').read()
m=re.search(r'^  pr_watcher:\s*$', text, re.M)
block=text[m.end():] if m else ''
n=re.search(r'^  \w+:\s*$', block, re.M)
block=block[:n.start()] if n else block
k=re.search(r'^\s*id:\s*([0-9a-fA-F-]{8,})', block, re.M)
print(k.group(1) if k else '')
" 2>/dev/null)"
        if [[ -n "$escalate" && "$escalate" != "$owner" ]]; then
            send_ping "$escalate" "**Escalation: remat hold has been open ${age_h}h.** Owner \`${owner}\` has been pinged at every rung and the kitchen is still dirty (${reason}), ${remaining} conflicts unresolved.

\`\`\`
${status_line}
\`\`\`

Raising it with you because owner-only pings are how a 41-hour hold passed unnoticed once already. Not asking you to take the absorb — just that a second seat (and the operator) can see the age." \
                && echo "kitchen-watchdog: escalated to $escalate at ${age_h}h"
        fi
    fi
    exit 1
fi

echo "kitchen-watchdog: DIRTY ($reason) but hapi-ping-peer is not on PATH" >&2
exit 2
