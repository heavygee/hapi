#!/usr/bin/env bash
# Smoke-test the AGENT_NOTIFY_SUMMARY stop guard.
#
# Positive control first: the first case is the VERBATIM broken line this
# session emitted on 2026-11-17 (missing closing brace). If the guard does not
# block on that, the rest of the suite proves nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/scripts/tooling/hapi-notify-summary-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Build a one-message transcript whose final assistant text is $1.
_transcript() {
    local text="$1" out="$TMP/t-$RANDOM.jsonl"
    python3 - "$out" "$text" <<'PY'
import json, sys
out, text = sys.argv[1], sys.argv[2]
rec = {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}
with open(out, "w") as fh:
    fh.write(json.dumps(rec) + "\n")
PY
    printf '%s' "$out"
}

_run() {
    local tpath="$1"
    jq -nc --arg t "$tpath" '{status:"completed", loop_count:0, transcript_path:$t}' | "$GUARD"
}

expect_block() {
    local text="$1" label="$2" out
    out="$(_run "$(_transcript "$text")")"
    if printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null 2>&1; then
        echo "OK block : $label"
        printf '          reason: %s\n' "$(printf '%s' "$out" | jq -r '.reason' | sed -n '3p' | sed 's/^ *//')"
    else
        echo "FAIL expected block: $label" >&2
        printf '%s\n' "$out" >&2
        exit 1
    fi
}

expect_allow() {
    local text="$1" label="$2" out
    out="$(_run "$(_transcript "$text")")"
    if printf '%s' "$out" | jq -e 'has("decision") | not' >/dev/null 2>&1; then
        echo "OK allow : $label"
    else
        echo "FAIL expected allow: $label" >&2
        printf '%s\n' "$out" >&2
        exit 1
    fi
}

# --- POSITIVE CONTROL: the actual 2026-11-17 regression, byte for byte ---
expect_block \
'Peer is active and had already reached the ansible conclusion.

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"Peer took ownership of #335 with a clean split."' \
    'real regression — unterminated, missing closing brace'

# --- the rest ---
expect_block \
'Body.

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"ok"}
Oh and one more thing.' \
    'content after the status line'

expect_block \
'Body.

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","action":"","summary":"ok"}' \
    'empty action string'

expect_block \
'Body.

AGENT_NOTIFY_SUMMARY {"version":1,"summary":"ok"}' \
    'missing required status key'

expect_block \
'Body.

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"one"}
AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"two"}' \
    'two status lines'

expect_allow \
'Body with a closing brace } in prose and "quotes".

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"All good."}' \
    'well-formed, no action key'

expect_allow \
'Body.

AGENT_NOTIFY_SUMMARY {"version":1,"status":"blocked","action":"await peer reply","summary":"Waiting."}' \
    'well-formed, with action'

expect_allow 'A turn with no status line at all.' 'no summary line — not this guard'

# aborted turns are exempt even when malformed
t="$(_transcript 'x

AGENT_NOTIFY_SUMMARY {"version":1,"status":"done","summary":"broken"')"
out="$(jq -nc --arg t "$t" '{status:"aborted", loop_count:0, transcript_path:$t}' | "$GUARD")"
printf '%s' "$out" | jq -e 'has("decision") | not' >/dev/null && echo "OK allow : aborted turn exempt"

# loop cap releases rather than trapping
out="$(jq -nc --arg t "$t" '{status:"completed", loop_count:3, transcript_path:$t}' | "$GUARD")"
printf '%s' "$out" | jq -e 'has("decision") | not' >/dev/null && echo "OK allow : loop cap releases at 3"

echo "ALL PASS"
