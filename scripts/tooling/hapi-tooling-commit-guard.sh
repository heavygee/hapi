#!/usr/bin/env bash
# Mess-maker tooling commit enforcement (Cursor + Claude).
#
# Policy: the agent session that dirties operator utensils on ~/coding/hapi
# (docs/tooling|operator|plans, scripts/tooling, config/driver-manifest.yaml,
# .cursor/rules) MUST commit those paths before ending the turn. The next
# agent who only needs sync/rebuild must NOT inherit cleanup.
#
# Modes (argv[1] or HOOK_MODE env):
#   record  — postToolUse / afterFileEdit: append covered paths to session ledger
#   stop    — stop: if this session still has outstanding dirt → followup_message
#   shell   — preToolUse Shell: deny sync/rebuild when THIS session has dirt
#
# Bypass (operator TTY only): HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE=1

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/hapi-tooling-dirt-ledger.sh
source "$ROOT/scripts/tooling/lib/hapi-tooling-dirt-ledger.sh"

MODE="${1:-${HOOK_MODE:-}}"
INPUT="$(cat)"

if [[ -z "$MODE" ]]; then
    # Infer from payload when installer wires one command for multiple events
    if printf '%s' "$INPUT" | jq -e 'has("loop_count") or (.status // "") == "completed" or (.status // "") == "aborted"' >/dev/null 2>&1; then
        MODE=stop
    elif printf '%s' "$INPUT" | jq -e '(.tool_name // .tool // "") | test("Shell|Bash")' >/dev/null 2>&1; then
        # Ambiguous: shell could be record-after or pre. Prefer explicit argv.
        MODE=shell
    else
        MODE=record
    fi
fi

_allow() {
    echo '{ "permission": "allow" }'
    exit 0
}

_empty_stop() {
    echo '{}'
    exit 0
}

if [[ "${HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE:-0}" = "1" ]] && [[ -t 0 ]]; then
    case "$MODE" in
        stop) _empty_stop ;;
        *) _allow ;;
    esac
fi

KEY="$(hapi_tooling_dirt_session_key_from_json "$INPUT")"

_extract_edit_paths() {
    printf '%s' "$INPUT" | jq -r '
        [
          .input.path,
          .tool_input.path,
          .input.target_notebook,
          .tool_input.target_notebook,
          .path,
          .file_path,
          .filePath,
          (.input.files // .tool_input.files // [])[]?,
          (.edited_files // .modified_files // [])[]?
        ]
        | map(select(type == "string" and . != ""))
        | .[]
    ' 2>/dev/null || true
}

_extract_shell_cmd() {
    printf '%s' "$INPUT" | jq -r '
        .input.command // .tool_input.command // .command // empty
    ' 2>/dev/null || true
}

case "$MODE" in
    record)
        while IFS= read -r p; do
            [[ -z "$p" ]] && continue
            hapi_tooling_dirt_record "$KEY" "$p"
        done < <(_extract_edit_paths)
        # Also catch shell redirects into tooling (best-effort)
        cmd="$(_extract_shell_cmd)"
        if [[ -n "$cmd" ]]; then
            # tee/redirect into covered paths under HAPI_ROOT
            if printf '%s' "$cmd" | grep -Eq '(>|>>|tee)[[:space:]].*(docs/(tooling|operator|plans)|scripts/tooling|config/driver-manifest\.yaml|\.cursor/rules)'; then
                # Record known targets when absolute/relative under mirror
                while IFS= read -r tok; do
                    case "$tok" in
                        *docs/tooling*|*docs/operator*|*docs/plans*|*scripts/tooling*|*driver-manifest.yaml*|*.cursor/rules*)
                            hapi_tooling_dirt_record "$KEY" "$tok"
                            ;;
                    esac
                done < <(printf '%s' "$cmd" | sed 's/[ \t"='"'"']=/\n/g' | grep -E 'docs/|scripts/tooling|driver-manifest|\.cursor/rules' || true)
            fi
            # Successful commit that touched our ledger → prune clean paths
            if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])git[[:space:]].*commit([[:space:]]|$)'; then
                hapi_tooling_dirt_clear_clean "$KEY"
            fi
        fi
        # postToolUse: optional context nudge (non-blocking)
        outstanding="$(hapi_tooling_dirt_outstanding "$KEY" | head -20 || true)"
        if [[ -n "$outstanding" ]]; then
            ctx="$(printf 'TOOLING DIRT (you made this mess): still uncommitted on the mirror — commit before ending this turn:\n%s' "$outstanding")"
            jq -n --arg ctx "$ctx" '{ additional_context: $ctx }'
        else
            echo '{}'
        fi
        exit 0
        ;;

    stop)
        status="$(printf '%s' "$INPUT" | jq -r '.status // "completed"' 2>/dev/null || echo completed)"
        if [[ "$status" == "aborted" || "$status" == "error" ]]; then
            _empty_stop
        fi
        loop="$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null || echo 0)"
        hapi_tooling_dirt_clear_clean "$KEY"
        outstanding="$(hapi_tooling_dirt_outstanding "$KEY" || true)"
        if [[ -z "$outstanding" ]]; then
            _empty_stop
        fi
        # Cap auto-followups so we do not infinite-loop (installer sets loop_limit)
        if [[ "${loop:-0}" -ge 4 ]]; then
            # Last nudge then stop — operator sees remaining dirt in message
            msg="STOPPED NAGGING after ${loop} follow-ups. YOUR tooling dirt is still uncommitted on ~/coding/hapi — commit it before anything else (do not leave it for the next agent):
$outstanding
Bypass (operator TTY only): HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE=1"
            jq -n --arg msg "$msg" \
                '{ followup_message: $msg, decision: "block", reason: $msg, hookSpecificOutput: { decision: "block", reason: $msg } }'
            exit 0
        fi
        msg="You dirtied operator tooling on the primary mirror and tried to end the turn without committing. YOU made this mess — commit (or revert) these paths before stopping. Do not leave porcelain for the next sync/rebuild agent.

Uncommitted (yours this session):
$outstanding

Example:
  cd ~/coding/hapi
  git add <those paths>
  git commit -m \"chore(tooling): <why>\"

Then continue. Bypass only with operator TTY: HAPI_OPERATOR_TOOLING_DIRT_OVERRIDE=1"
        jq -n --arg msg "$msg" \
            '{ followup_message: $msg, decision: "block", reason: $msg, hookSpecificOutput: { decision: "block", reason: $msg } }'
        exit 0
        ;;

    shell)
        cmd="$(_extract_shell_cmd)"
        # Record redirects / prune after commits even when not gating
        if printf '%s' "$cmd" | grep -Eq '(>|>>|tee)[[:space:]].*(docs/(tooling|operator|plans)|scripts/tooling|config/driver-manifest|\.cursor/rules)'; then
            while IFS= read -r tok; do
                case "$tok" in
                    *docs/*|*scripts/tooling*|*driver-manifest*|*cursor/rules*)
                        hapi_tooling_dirt_record "$KEY" "$tok"
                        ;;
                esac
            done < <(printf '%s' "$cmd" | sed 's/[ \t"='"'"']=/\n/g' | grep -E 'docs/|scripts/tooling|driver-manifest|\.cursor/rules' || true)
        fi
        if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])git[[:space:]].*commit([[:space:]]|$)'; then
            hapi_tooling_dirt_clear_clean "$KEY"
        fi
        # Only hard-gate sync / full rebuild entrypoints
        if ! printf '%s' "$cmd" | grep -Eq '(^|[[:space:]/])(hapi-sync-fork-main|hapi-driver-rebuild)([[:space:]]|$)'; then
            _allow
        fi
        hapi_tooling_dirt_clear_clean "$KEY"
        outstanding="$(hapi_tooling_dirt_outstanding "$KEY" || true)"
        if [[ -n "$outstanding" ]]; then
            jq -n \
                --arg msg "Blocked: YOU still have uncommitted tooling dirt on the mirror from this session. Commit it before hapi-sync-fork-main / hapi-driver-rebuild — do not push cleanup onto the next agent.

Your outstanding paths:
$outstanding" \
                --arg user "Blocked: commit your mirror tooling dirt before sync/rebuild." \
                '{ permission: "deny", agent_message: $msg, user_message: $user }'
            exit 0
        fi
        # Others' dirt: do not assign cleanup to this agent — sync script will still refuse.
        other="$(git -C "$HAPI_ROOT" status --porcelain -u --untracked-files=all 2>/dev/null | head -40 || true)"
        if [[ -n "$other" ]]; then
            jq -n --arg ctx "Mirror is dirty, but not from YOUR session ledger. Sync/rebuild will refuse until owners commit. Do NOT inherit cleanup — identify owners or ask the operator. Porcelain sample:
$other" \
                '{ permission: "allow", agent_message: $ctx }'
            exit 0
        fi
        _allow
        ;;

    *)
        echo "Unknown mode: $MODE" >&2
        echo '{}'
        exit 0
        ;;
esac
