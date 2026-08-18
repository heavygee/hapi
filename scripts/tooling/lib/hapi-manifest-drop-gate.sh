#!/usr/bin/env bash
# Refuse removing manifest layers whose heavygee/hapi PR is still OPEN.
# Override (operator TTY): HAPI_MANIFEST_DROP_OPEN_PR=1 + named branch in env
#   HAPI_MANIFEST_DROP_ALLOW_BRANCH=feat/foo,driver/bar
#
# shellcheck disable=SC2034
HAPI_MANIFEST_DROP_GATE_VERSION=1

hapi_manifest_list_active_branches() {
    local file="$1"
    [[ -f "$file" ]] || return 0
    grep -E '^[[:space:]]+-[[:space:]]+branch:' "$file" \
        | sed -E 's/^[[:space:]]+-[[:space:]]+branch:[[:space:]]*//' \
        | sed -E 's/[[:space:]]+#.*$//' \
        | sed 's/[[:space:]]*$//' \
        | grep -v '^$' || true
}

hapi_manifest_removed_branches() {
    local old_file="$1" new_file="$2"
    comm -23 \
        <(hapi_manifest_list_active_branches "$old_file" | sort -u) \
        <(hapi_manifest_list_active_branches "$new_file" | sort -u)
}

hapi_manifest_drop_allow_branch() {
    local branch="$1"
    [[ "${HAPI_MANIFEST_DROP_OPEN_PR:-}" == "1" ]] || return 1
    local allow="${HAPI_MANIFEST_DROP_ALLOW_BRANCH:-}"
    [[ -z "$allow" ]] && return 1
    local item
    IFS=',' read -ra items <<<"$allow"
    for item in "${items[@]}"; do
        item="${item#"${item%%[![:space:]]*}"}"
        item="${item%"${item##*[![:space:]]}"}"
        [[ "$item" == "$branch" ]] && return 0
    done
    return 1
}

hapi_manifest_fork_pr_open_for_branch() {
    local branch="$1"
    local count
    if ! command -v gh >/dev/null 2>&1; then
        echo "gh missing — cannot verify OPEN PR for branch $branch" >&2
        return 2
    fi
    count="$(gh pr list -R heavygee/hapi --head "heavygee:${branch}" --state open --json number -q 'length' 2>/dev/null || echo "")"
    if [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]]; then
        return 0
    fi
    return 1
}

# hapi_manifest_drop_gate_check_file <old> <new> — exit 1 when blocked
hapi_manifest_drop_gate_check_file() {
    local old_file="$1" new_file="$2"
    local branch blocked=()
    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue
        if hapi_manifest_drop_allow_branch "$branch"; then
            continue
        fi
        if hapi_manifest_fork_pr_open_for_branch "$branch"; then
            blocked+=("$branch")
        fi
    done < <(hapi_manifest_removed_branches "$old_file" "$new_file")

    if [[ "${#blocked[@]}" -eq 0 ]]; then
        return 0
    fi

    echo "manifest-drop-gate: refusing to remove layer(s) with OPEN heavygee/hapi PR:" >&2
    for branch in "${blocked[@]}"; do
        gh pr list -R heavygee/hapi --head "heavygee:${branch}" --state open \
            --json number,title \
            -q ".[] | \"  - #\(.number) \(.title) (branch: ${branch})\"" 2>/dev/null \
            || echo "  - branch: $branch (OPEN PR — gh list failed)" >&2
    done
    echo "" >&2
    echo "Repo recipe is config/driver-manifest.yaml. Do not copy stale ~/.config over repo." >&2
    echo "Operator override this turn only: HAPI_MANIFEST_DROP_OPEN_PR=1 HAPI_MANIFEST_DROP_ALLOW_BRANCH=<branch>" >&2
    echo "Canon: docs/tooling/driver-soup.md § Manifest drop is not absorb" >&2
    return 1
}

# hapi_manifest_drop_gate_check_staged <repo_root> — compares HEAD vs index for manifest
hapi_manifest_drop_gate_check_staged() {
    local root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
    local manifest_rel="config/driver-manifest.yaml"
    local old new tmp
    old="$(mktemp)"
    new="$(mktemp)"
    trap 'rm -f "$old" "$new"' RETURN
    if git -C "$root" show "HEAD:${manifest_rel}" >"$old" 2>/dev/null; then
        :
    else
        : >"$old"
    fi
    git -C "$root" show ":${manifest_rel}" >"$new" 2>/dev/null || cp "$root/$manifest_rel" "$new"
    hapi_manifest_drop_gate_check_file "$old" "$new"
}
