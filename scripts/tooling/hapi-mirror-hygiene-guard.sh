#!/usr/bin/env bash
# Cursor / Claude preToolUse: keep the primary mirror porcelain-clean for soup remakes.
#
# Blocks agent tool-calls that skunk shared utensils on ~/coding/hapi (mirror root):
#   (A) Shell: bun/npm/pnpm/yarn install|add|ci when cwd / cd target is the mirror
#       (not under worktrees/), or when install has no worktree target at all
#   (B) Shell: redirects / tee into mirror package.json, lockfiles, or e2e/
#   (C) Write|Edit|StrReplace|… to those same mirror paths
#
# Incident class: 2026-07-18 #1084 peer ran `cd ~/coding/hapi && bun install` and
# left e2e/peer/*.spec.ts on mirror main — blocked rematerialize for every agent.
#
# Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1

set -uo pipefail

INPUT=$(cat)

HAPI_ROOT="${HAPI_ROOT_OVERRIDE:-$HOME/coding/hapi}"
# Normalize trailing slash
HAPI_ROOT="${HAPI_ROOT%/}"

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // .tool // empty' 2>/dev/null || true)

if [ "${HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE:-0}" = "1" ] && [ -t 0 ]; then
    echo '{ "permission": "allow" }'
    exit 0
fi

_deny() {
    local msg="$1"
    local user="${2:-Blocked: mirror hygiene — do not dirty ~/coding/hapi (soup utensils). Use a worktree.}"
    jq -n \
        --arg msg "$msg" \
        --arg user "$user" \
        '{
            permission: "deny",
            agent_message: $msg,
            user_message: $user
        }'
    exit 0
}

_abs_norm() {
    local p="$1"
    case "$p" in
        /*) ;;
        *) p="${PWD}/${p}" ;;
    esac
    printf '%s' "$p" | sed -e 's://*:/:g' -e 's:/\./:/:g' -e 's:/$::'
}

# True if path is under HAPI_ROOT/worktrees/ (feature worktrees — install/write OK).
_under_worktree() {
    case "$1" in
        "$HAPI_ROOT"/worktrees/*) return 0 ;;
        *) return 1 ;;
    esac
}

# True if path is exactly the primary mirror root (shared utensils).
_is_mirror_root() {
    [ "$1" = "$HAPI_ROOT" ]
}

# True if path is on the mirror but NOT a worktree (includes mirror root, e2e/, etc.).
# Driver/upstream/active are separate trees — this guard focuses on mirror skunking.
_on_dirtyable_mirror() {
    local p="$1"
    case "$p" in
        "$HAPI_ROOT"/worktrees/*) return 1 ;;
        "$HAPI_ROOT"/driver/*|"$HAPI_ROOT"/driver) return 1 ;;
        "$HAPI_ROOT"/upstream/*|"$HAPI_ROOT"/upstream) return 1 ;;
        "$HAPI_ROOT"/active/*|"$HAPI_ROOT"/active) return 1 ;;
        "$HAPI_ROOT"|"$HAPI_ROOT"/*) return 0 ;;
        *) return 1 ;;
    esac
}

_is_protected_mirror_file() {
    local p="$1"
    _on_dirtyable_mirror "$p" || return 1
    case "$p" in
        "$HAPI_ROOT"/package.json) return 0 ;;
        "$HAPI_ROOT"/bun.lock|"$HAPI_ROOT"/package-lock.json|"$HAPI_ROOT"/yarn.lock|"$HAPI_ROOT"/pnpm-lock.yaml) return 0 ;;
        "$HAPI_ROOT"/e2e|"$HAPI_ROOT"/e2e/*) return 0 ;;
        *) return 1 ;;
    esac
}

# ── Write / Edit path guard ──────────────────────────────────────────────────
TARGET=$(printf '%s' "$INPUT" | jq -r '
    [
      .input.path,
      .tool_input.path,
      .input.target_notebook,
      .tool_input.target_notebook,
      .path
    ]
    | map(select(. != null and . != ""))
    | first // empty
' 2>/dev/null || true)

if [ -n "$TARGET" ]; then
    ABS=$(_abs_norm "$TARGET")
    if _is_protected_mirror_file "$ABS"; then
        _deny "$(cat <<EOF
Mirror utensil write BLOCKED (soup hygiene).

Target: $ABS
Tool:   ${TOOL:-unknown}

~/coding/hapi is the primary mirror. package.json, lockfiles, and e2e/ on the
mirror are shared utensils — dirtying them blocks hapi-sync-fork-main and
hapi-driver-rebuild for every agent.

Do this instead:
  1. cd ~/coding/hapi/worktrees/<your-feature>/
  2. Write the file / run bun install THERE
  3. Leave mirror git status clean (except intentional soup manifest WIP)

Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1

See: docs/tooling/driver-soup.md#mirror-utensil-hygiene
EOF
)"
    fi
fi

# ── Shell guard ──────────────────────────────────────────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '
    [
      .command,
      .input.command,
      .tool_input.command,
      .input.cmd,
      .tool_input.cmd
    ]
    | map(select(. != null and . != ""))
    | first // empty
' 2>/dev/null || true)

CWD=$(printf '%s' "$INPUT" | jq -r '
    [
      .working_directory,
      .input.working_directory,
      .tool_input.working_directory,
      .cwd
    ]
    | map(select(. != null and . != ""))
    | first // empty
' 2>/dev/null || true)

if [ -z "$CMD" ]; then
    echo '{ "permission": "allow" }'
    exit 0
fi

# Inverted manifest sync (~/.config → repo) dropped open-PR soup layers (heavygee#133, 2026-08-18).
if printf '%s' "$CMD" | grep -qiE '(^|[[:space:]|&;])(cp|rsync|mv|tee)([[:space:]|&;]|$)'; then
    if printf '%s' "$CMD" | grep -qE '\.config/hapi/driver-manifest(\.yaml)?'; then
        if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|&;<>])(config/driver-manifest\.yaml|'"$HAPI_ROOT"'/config/driver-manifest\.yaml)'; then
            _deny "Blocked: copying ~/.config/hapi/driver-manifest.yaml → repo config/driver-manifest.yaml (inverted sync).

Recipe is repo config/driver-manifest.yaml. Mirror the other way:
  scripts/tooling/hapi-manifest-mirror-to-config.sh

Canon: docs/plans/2026-08-18-overseer-brain-active-soup-drop-postmortem.md" \
                "Blocked: do not copy ~/.config driver-manifest into the repo. Edit config/driver-manifest.yaml and use hapi-manifest-mirror-to-config.sh."
        fi
    fi
fi

CWD_ABS=""
if [ -n "$CWD" ]; then
    CWD_ABS=$(_abs_norm "$CWD")
fi

# Package-manager install / add / ci
_pkg_install=0
if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|&;])(bun|npm|pnpm|yarn)[[:space:]]+(install|add|ci)([[:space:]|&;]|$)'; then
    _pkg_install=1
elif printf '%s' "$CMD" | grep -qE '(^|[[:space:]|&;])npm[[:space:]]+i([[:space:]|&;]|$)'; then
    _pkg_install=1
fi

if [ "$_pkg_install" = "1" ]; then
    _allow_install=0

    # Explicit cd / pushd into a worktree before install → allow
    if printf '%s' "$CMD" | grep -qE "(cd|pushd)[[:space:]]+[\"']?${HAPI_ROOT}/worktrees/"; then
        _allow_install=1
    fi

    # working_directory under worktree → allow
    if [ -n "$CWD_ABS" ] && _under_worktree "$CWD_ABS"; then
        _allow_install=1
    fi

    # Explicit cd to mirror root (or bare HAPI_ROOT) → deny (even if somehow also worktree — root wins)
    if printf '%s' "$CMD" | grep -qE "(cd|pushd)[[:space:]]+[\"']?${HAPI_ROOT}([\"'[:space:]|&;]|$)"; then
        # Exception: cd to worktrees already allowed above; re-check not worktree-only
        if ! printf '%s' "$CMD" | grep -qE "(cd|pushd)[[:space:]]+[\"']?${HAPI_ROOT}/worktrees/"; then
            _allow_install=0
            _deny "$(cat <<EOF
Mirror bun/npm install BLOCKED (soup hygiene).

Command: $CMD
Tool:    ${TOOL:-Shell}

NEVER run package installs on ~/coding/hapi (primary mirror). That dirties
package.json / bun.lock and blocks soup rematerialize for every agent.

Required:
  cd ~/coding/hapi/worktrees/<your-feature> && bun install

Incident class: 2026-07-18 #1084 peer skunked the kitchen this way.

Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1
EOF
)"
        fi
    fi

    # CWD is mirror root → deny
    if [ -n "$CWD_ABS" ] && _is_mirror_root "$CWD_ABS"; then
        _allow_install=0
        _deny "$(cat <<EOF
Mirror bun/npm install BLOCKED (soup hygiene).

Command: $CMD
cwd:     $CWD_ABS
Tool:    ${TOOL:-Shell}

working_directory is the primary mirror. Run installs inside a feature worktree.

  cd ~/coding/hapi/worktrees/<your-feature> && bun install

Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1
EOF
)"
    fi

    # No clear worktree target → deny (Cursor workspace root is usually the mirror)
    if [ "$_allow_install" = "0" ]; then
        _deny "$(cat <<EOF
Package install BLOCKED without a worktree target (soup hygiene).

Command: $CMD
cwd:     ${CWD_ABS:-"(unset — treated as unsafe)"}
Tool:    ${TOOL:-Shell}

Mirror ~/coding/hapi must stay porcelain-clean. If you need deps for peer e2e:
  cd ~/coding/hapi/worktrees/<your-feature> && bun install

Do not assume the Cursor workspace root is safe — it is the shared mirror.

Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1
EOF
)"
    fi
fi

# Shell redirects / tee into protected mirror paths
# Match common write shapes without requiring full shell parse.
_redir_hit=0
if printf '%s' "$CMD" | grep -qE "(>|>>|tee[[:space:]])[^\n]*${HAPI_ROOT}/(package\.json|bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|e2e/)"; then
    _redir_hit=1
fi
# Relative e2e/ writes when cwd is mirror root
if [ -n "$CWD_ABS" ] && _is_mirror_root "$CWD_ABS"; then
    if printf '%s' "$CMD" | grep -qE '(>|>>|tee[[:space:]])[^\n]*(^|[[:space:]\"'\''=/])e2e/'; then
        _redir_hit=1
    fi
    if printf '%s' "$CMD" | grep -qE '(>|>>|tee[[:space:]])[^\n]*(package\.json|bun\.lock)'; then
        _redir_hit=1
    fi
fi

if [ "$_redir_hit" = "1" ]; then
    _deny "$(cat <<EOF
Mirror utensil shell-write BLOCKED (soup hygiene).

Command: $CMD
Tool:    ${TOOL:-Shell}

Do not redirect into mirror package.json, lockfiles, or e2e/. Use a worktree.

Bypass (operator TTY only): HAPI_OPERATOR_MIRROR_HYGIENE_OVERRIDE=1
EOF
)"
fi

echo '{ "permission": "allow" }'
exit 0
