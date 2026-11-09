#!/usr/bin/env bash
# hapi-kill-verify.sh — verify-don't-assume process death.
#
# `kill` returning 0 means the signal was *delivered*, never that the process
# died. hapi-claude-reopen-mismatch.sh used to SIGTERM->sleep->SIGKILL and then
# proceed straight to archive+reopen with no re-check — a kill that is assumed
# rather than confirmed is exactly how two agents end up bound to one session
# id. This lib is the single source of truth for the poll-until-dead-or-bail
# algorithm, used both locally (sourced directly) and remotely (serialized via
# `declare -f` into an SSH payload, so there is one authored copy, not two).
#
# hapi_kill_verify_wait_dead <pid> [timeout_s=5] [poll_s=0.2]
#   Returns 0 iff the pid is confirmed gone within the bound.
#   Returns 1 iff the pid is still present when the bound expires — a
#   confirmed survivor. Callers MUST treat a 1 as "do not proceed", not as a
#   soft warning.
hapi_kill_verify_wait_dead() {
    local pid="$1" timeout="${2:-5}" poll="${3:-0.2}"
    local waited=0
    while awk "BEGIN{exit !($waited < $timeout)}"; do
        [[ -d "/proc/$pid" ]] || return 0
        sleep "$poll"
        waited=$(awk "BEGIN{print $waited + $poll}")
    done
    [[ -d "/proc/$pid" ]] && return 1 || return 0
}
