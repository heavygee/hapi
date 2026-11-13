#!/usr/bin/env bash
# Regression tests for the Claude PreToolUse adapter.
#
# The case that matters: context-mode runs arbitrary code in a subprocess, so it
# is a second shell. Until 2026-11-12 the matchers listed only Bash and the
# sub-guards only read .tool_input.command, so anything routed through
# ctx_execute / ctx_execute_file / ctx_batch_execute bypassed every guard here.
# A #987 peer ran a raw gradle build that way, past the estate lock.
#
# Fixtures live in this file rather than inline on a command line because the
# guards are textual: a test that echoes a banned command gets itself blocked.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${ROOT}/scripts/tooling/hapi-claude-pretooluse-guard.sh"
fails=0

# Assembled at runtime so this file can be edited without tripping the guard
# that reads the editor's own payload.
BANNED="sudo systemctl"" restart hapi-hub.service"

verdict() {
    printf '%s' "$1" | "$GUARD" 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("allow"); raise SystemExit
o = d.get("hookSpecificOutput", {})
print("deny" if o.get("permissionDecision") == "deny" else "allow")
' 2>/dev/null || echo allow
}

expect() {
    local label="$1" want="$2" payload="$3" got
    got="$(verdict "$payload")"
    if [[ "$got" == "$want" ]]; then
        echo "OK:   $label ($got)"
    else
        echo "FAIL: $label — wanted $want, got $got"
        fails=$((fails + 1))
    fi
}

payload_bash() {
    jq -n --arg c "$BANNED" '{tool_name:"Bash", tool_input:{command:$c}}'
}
payload_ctx_code() {
    jq -n --arg c "$BANNED" --arg l "$1" \
        '{tool_name:"mcp__plugin_context-mode_context-mode__ctx_execute",
          tool_input:{language:$l, code:$c}}'
}
payload_ctx_python_subprocess() {
    local code
    code="import subprocess; subprocess.run([${BANNED// /\", \"}], shell=False)"
    jq -n --arg c "$code" \
        '{tool_name:"mcp__plugin_context-mode_context-mode__ctx_execute",
          tool_input:{language:"python", code:$c}}'
}
payload_ctx_batch() {
    jq -n --arg c "$BANNED" \
        '{tool_name:"mcp__plugin_context-mode_context-mode__ctx_batch_execute",
          tool_input:{commands:[{label:"step", command:$c}]}}'
}
payload_ctx_file() {
    jq -n --arg c "$BANNED" \
        '{tool_name:"mcp__plugin_context-mode_context-mode__ctx_execute_file",
          tool_input:{path:"/tmp/x.sh", language:"bash", code:$c}}'
}
payload_harmless() {
    jq -n '{tool_name:"mcp__plugin_context-mode_context-mode__ctx_execute",
            tool_input:{language:"python", code:"print(1 + 1)"}}'
}

# Control first: if the Bash path ever stops denying, every ctx result below is
# meaningless and the suite must not read as green.
expect "control: banned command via Bash"      deny  "$(payload_bash)"
expect "ctx_execute (bash)"                    deny  "$(payload_ctx_code bash)"
expect "ctx_execute (shell)"                   deny  "$(payload_ctx_code shell)"
expect "ctx_execute (python shelling out)"     deny  "$(payload_ctx_python_subprocess)"
expect "ctx_batch_execute commands[]"          deny  "$(payload_ctx_batch)"
expect "ctx_execute_file"                      deny  "$(payload_ctx_file)"
expect "harmless ctx_execute stays allowed"    allow "$(payload_harmless)"

if [[ "$fails" -ne 0 ]]; then
    echo "hapi-claude-pretooluse-guard.test.sh: $fails failure(s)"
    exit 1
fi
echo "hapi-claude-pretooluse-guard.test.sh: all cases OK"
