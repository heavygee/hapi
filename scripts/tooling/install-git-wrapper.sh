#!/usr/bin/env bash
# Install ~/.local/bin/git wrapper (worktree guard + optional cold-review push hint).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="${REPO_ROOT}/scripts/tooling/git-shim-worktree-guard.sh"
DEST="${HAPI_GIT_WRAPPER_DEST:-$HOME/.local/bin/git}"
REAL_GIT="${HAPI_REAL_GIT:-/usr/bin/git}"

[[ -x "$GUARD" ]] || { echo "ERROR: missing $GUARD" >&2; exit 1; }
[[ -x "$REAL_GIT" ]] || { echo "ERROR: real git not found at $REAL_GIT" >&2; exit 1; }

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" && ! -L "$DEST" ]] && ! grep -q 'git-shim-worktree-guard' "$DEST" 2>/dev/null; then
  cp -a "$DEST" "${DEST}.prev"
  echo "Backed up previous git wrapper → ${DEST}.prev"
fi

cat >"$DEST" <<WRAP
#!/bin/bash
# git wrapper: canonical worktree guard inside ~/coding/hapi clone.
# Bypass: HAPI_SKIP_WORKTREE_GUARD=1

if [[ "\${1:-}" == "push" ]]; then
    cmd="git \$*"
    if [ -f "\$HOME/.local/bin/pr-open-push-lib.sh" ]; then
        # shellcheck source=/dev/null
        source "\$HOME/.local/bin/pr-open-push-lib.sh"
        branch=\$(pr_extract_push_branch "\$cmd" || true)
        if [ -n "\$branch" ]; then
            lookup=\$(pr_open_push_lookup "\$branch" || true)
            if [ -n "\$lookup" ]; then
                pr=\$(echo "\$lookup" | awk '{print \$1}')
                base=\$(echo "\$lookup" | awk '{print \$2}')
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                pr_open_push_cold_review_message "\$branch" "\$pr" "\$base" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            fi
        fi
    fi
fi

_sub=""
_sub2=""
_chdir=""
_i=1
while [[ "\$_i" -le "\$#" ]]; do
    _a="\${!_i}"
    case "\$_a" in
        -C) _j=\$((_i + 1)); _chdir="\${_j:-}"; _i=\$((_i + 2)) ;;
        -c|--git-dir|--work-tree|--namespace|--exec-path|--list-cmds|--super-prefix) _i=\$((_i + 2)) ;;
        --bare|--paginate|--no-pager|-p|-P|--no-optional-locks|\
        --literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|\
        --no-replace-objects) _i=\$((_i + 1)) ;;
        --*=*|-*) _i=\$((_i + 1)) ;;
        *) _sub="\$_a"; _j=\$((_i + 1)); _sub2="\${_j:-}"; break ;;
    esac
done

if [[ "\$_sub" == "worktree" && "\$_sub2" == "add" ]]; then
    _GUARD="${GUARD}"
    if [[ -x "\$_GUARD" ]]; then
        if [[ -n "\$_chdir" && -d "\$_chdir" ]]; then
            ( cd "\$_chdir" && "\$_GUARD" "\${@:\$_i}" )
        else
            "\$_GUARD" "\${@:\$_i}"
        fi
        _rc=\$?
        if [[ "\$_rc" -ne 0 ]]; then exit "\$_rc"; fi
    fi
fi

exec ${REAL_GIT} "\$@"
WRAP

chmod +x "$DEST"
echo "Installed git wrapper → $DEST"
echo "  - Blocks non-canonical git worktree add under ~/coding/hapi"
echo "Verify: which git  →  should be $DEST"
