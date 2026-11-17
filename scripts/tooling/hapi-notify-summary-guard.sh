#!/usr/bin/env bash
# Stop-hook guard: AGENT_NOTIFY_SUMMARY must be parseable JSON.
#
# Why this exists. The session-status contract asks every turn to end with one
# machine-readable line:
#
#   AGENT_NOTIFY_SUMMARY {"version":1,"status":"...","summary":"..."}
#
# It is consumed by a parser, not by a human, so a malformed line is not a
# cosmetic slip — it is a silently dropped status. And the failure is invisible
# from inside the turn: the prose above it reads fine, the line *looks* fine at
# a glance, and nothing complains. On 2026-11-17 this session emitted four
# consecutive summaries that ended `..."` with no closing brace. All four were
# unparseable. The 214 before them, same session, were well-formed — the
# regression started after a context compaction and nothing caught it for four
# turns. An operator noticed, which is exactly the wrong detector.
#
# So: validate it where it is cheap and certain, at Stop, against the bytes
# actually emitted. Blocks the stop with a specific reason naming the defect,
# so the turn re-emits a correct line rather than being told "it's broken".
#
# Loop-capped like the sibling dirt guard: nag at most 3 times, then let the
# turn end rather than trap it.
#
# CAVEAT, learned the hard way within an hour of writing this: hooks are read
# from .claude/settings.json at SESSION START. This guard cannot protect the
# session that installs it. The same session emitted a fifth malformed line
# immediately after committing the guard, and the guard was not consulted —
# replaying it against that transcript at the exact Stop point blocks correctly.
# If you add or change a Stop hook and want it live now, restart the session;
# otherwise assume zero coverage until then.
set -euo pipefail

INPUT="$(cat || true)"

_allow() { printf '{}\n'; exit 0; }

_block() {
    local msg="$1"
    jq -n --arg msg "$msg" \
        '{ followup_message: $msg, decision: "block", reason: $msg,
           hookSpecificOutput: { decision: "block", reason: $msg } }'
    exit 0
}

command -v jq >/dev/null 2>&1 || _allow
[[ -n "$INPUT" ]] || _allow

# Operator escape hatch (TTY only, same shape as the dirt guard).
[[ "${HAPI_OPERATOR_NOTIFY_SUMMARY_OVERRIDE:-}" == "1" ]] && _allow

status="$(printf '%s' "$INPUT" | jq -r '.status // "completed"' 2>/dev/null || echo completed)"
# An aborted/errored turn has no obligation to carry a summary.
[[ "$status" == "aborted" || "$status" == "error" ]] && _allow

loop="$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null || echo 0)"
[[ "${loop:-0}" -ge 3 ]] && _allow

transcript="$(printf '%s' "$INPUT" | jq -r '.transcript_path // .agent_transcript_path // empty' 2>/dev/null || true)"
[[ -n "$transcript" && -f "$transcript" ]] || _allow

# Pull the final assistant text block and check the summary line in it.
verdict="$(
    TRANSCRIPT="$transcript" python3 - <<'PY' 2>/dev/null || true
import json, os, re, sys

path = os.environ["TRANSCRIPT"]
last = None
try:
    with open(path, errors="replace") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "assistant":
                continue
            content = (rec.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if block.get("type") == "text" and (block.get("text") or "").strip():
                    last = block["text"]
except Exception:
    sys.exit(0)

if last is None:
    sys.exit(0)

hits = list(re.finditer(r"^AGENT_NOTIFY_SUMMARY.*$", last, re.MULTILINE))
if not hits:
    # Silence is not this guard's business; the contract covers final answers
    # only and we cannot reliably tell those apart from progress turns here.
    sys.exit(0)

if len(hits) > 1:
    print(f"emitted {len(hits)} AGENT_NOTIFY_SUMMARY lines; the contract allows exactly one")
    sys.exit(0)

hit = hits[0]
payload = hit.group(0)[len("AGENT_NOTIFY_SUMMARY"):].strip()

trailing = last[hit.end():].strip()
if trailing:
    print("content appears after the AGENT_NOTIFY_SUMMARY line; it must be the final line "
          f"(saw {trailing[:60]!r} after it)")
    sys.exit(0)

try:
    obj = json.loads(payload)
except Exception as exc:
    hint = ""
    if payload.startswith("{") and not payload.rstrip().endswith("}"):
        hint = " — the line is UNTERMINATED: it is missing its closing '}'"
    elif not payload.startswith("{"):
        hint = " — the token must be followed by a single JSON object"
    print(f"AGENT_NOTIFY_SUMMARY is not parseable JSON ({exc}){hint}. "
          f"Emitted payload ended: {payload[-60:]!r}")
    sys.exit(0)

if not isinstance(obj, dict):
    print("AGENT_NOTIFY_SUMMARY payload must be a JSON object")
    sys.exit(0)

missing = [k for k in ("version", "status", "summary") if k not in obj]
if missing:
    print(f"AGENT_NOTIFY_SUMMARY is missing required key(s): {', '.join(missing)}")
    sys.exit(0)

if "action" in obj and not str(obj["action"]).strip():
    print('AGENT_NOTIFY_SUMMARY carries an empty "action" — omit the key entirely instead '
          "(an empty string breaks downstream parsers)")
    sys.exit(0)
PY
)"

[[ -z "${verdict//[[:space:]]/}" ]] && _allow

_block "YOUR LAST TURN'S STATUS LINE IS MALFORMED and was silently dropped by the consumer.

  ${verdict}

Re-send your previous reply's final line, corrected. It must be the last line of
the message, on its own, in exactly this shape (note the closing brace):

  AGENT_NOTIFY_SUMMARY {\"version\":1,\"status\":\"done\",\"summary\":\"...\"}

Do not re-do the work and do not re-explain it — only the status line was wrong.
Bypass (operator TTY only): HAPI_OPERATOR_NOTIFY_SUMMARY_OVERRIDE=1"
