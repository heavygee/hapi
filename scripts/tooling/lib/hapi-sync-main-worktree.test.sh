#!/usr/bin/env bash
set -euo pipefail
# Inline the helper (same body as hapi-sync-fork-main.sh)
hapi_sync_main_worktree() {
    local primary="$1" branch="$2"
    local wt="" line
    while IFS= read -r line; do
        case "$line" in
            worktree\ *)
                wt="${line#worktree }"
                ;;
            branch\ refs/heads/"$branch")
                if [[ -n "$wt" ]]; then
                    printf '%s\n' "$wt"
                    return 0
                fi
                ;;
            "")
                wt=""
                ;;
        esac
    done < <(git -C "$primary" worktree list --porcelain 2>/dev/null)
    return 1
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email t@t
git -C "$tmpdir" config user.name t
echo a >"$tmpdir/f" && git -C "$tmpdir" add f && git -C "$tmpdir" commit -q -m a
git -C "$tmpdir" branch -M main
# linked worktree on feature branch
git -C "$tmpdir" worktree add -q "$tmpdir/feature" -b feat HEAD
got="$(hapi_sync_main_worktree "$tmpdir/feature" main)"
[[ "$got" == "$tmpdir" ]] || { echo "FAIL: expected $tmpdir got '$got'" >&2; exit 1; }
echo "hapi-sync-main-worktree.test.sh: all passed"
