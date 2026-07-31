#!/usr/bin/env bash
# pr-merge-policy.sh — estate overlay: chip stays health; lane is local policy.
#
# Chip status (clean/pending/…) stays generic/upstreamable.
# This lib answers: given a *clean* PR, is it lane A (wait maintainer) or
# lane B (collaborator self-merge eligible)?
#
# Deterministic size/"small enough" is intentionally NOT the sole signal —
# auto-B is strict (no product paths). Human promote via GitHub label or
# allowlisted PR number covers focused runtime fixes (e.g. stale model remap).
#
# Config: ~/.hapi/pr-merge-policy.json (see pr-merge-policy.example.json)
# Sourced by hapi-meta-daily.sh. Unit tests: pr-merge-policy.test.sh

pmp_default_policy_json() {
    cat <<'EOF'
{
  "schema": 1,
  "default_lane": "maintainer",
  "self_merge": {
    "github_labels": ["low-impact"],
    "allow_pr_numbers": [],
    "auto": {
      "product_path_prefixes": ["cli/src/", "hub/src/", "web/src/", "shared/src/"],
      "test_path_substrings": [".test.", ".spec.", "__tests__", "/tests/", "e2e/"],
      "max_changed_files": 8,
      "max_delta_lines": 120
    }
  }
}
EOF
}

# pmp_load_policy [path] → JSON on stdout
pmp_load_policy() {
    local path="${1:-${HAPI_PR_MERGE_POLICY:-$HOME/.hapi/pr-merge-policy.json}}"
    if [[ -f "$path" ]]; then
        jq -c '.' "$path" 2>/dev/null || pmp_default_policy_json | jq -c .
    else
        pmp_default_policy_json | jq -c .
    fi
}

# pmp_path_is_test PATH POLICY_JSON → 0 if test-ish
pmp_path_is_test() {
    local path="$1" policy="$2" sub
    while IFS= read -r sub; do
        [[ -z "$sub" ]] && continue
        [[ "$path" == *"$sub"* ]] && return 0
    done < <(printf '%s' "$policy" | jq -r '.self_merge.auto.test_path_substrings[]?')
    return 1
}

# pmp_path_is_product PATH POLICY_JSON → 0 if product (non-test under prefixes)
pmp_path_is_product() {
    local path="$1" policy="$2" pref
    if pmp_path_is_test "$path" "$policy"; then
        return 1
    fi
    while IFS= read -r pref; do
        [[ -z "$pref" ]] && continue
        [[ "$path" == "$pref"* ]] && return 0
    done < <(printf '%s' "$policy" | jq -r '.self_merge.auto.product_path_prefixes[]?')
    return 1
}

# pmp_files_have_product FILES_NL POLICY_JSON → 0 if any product file
pmp_files_have_product() {
    local files="$1" policy="$2" f
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        if pmp_path_is_product "$f" "$policy"; then
            return 0
        fi
    done <<<"$files"
    return 1
}

# pmp_classify POLICY_JSON PR_NUMBER FILES_NL ADDITIONS DELETIONS LABELS_CSV
# Prints: lane<TAB>reason
#   lane: maintainer | self_merge
#   reason: short machine token
pmp_classify() {
    local policy="$1" pr="$2" files="$3" additions="${4:-0}" deletions="${5:-0}" labels="${6:-}"
    local default_lane
    default_lane="$(printf '%s' "$policy" | jq -r '.default_lane // "maintainer"')"

    # Human promote: label or allowlist (covers "small enough" product fixes)
    local lab allow labels_lc
    labels_lc="$(printf '%s' "$labels" | tr '[:upper:]' '[:lower:]')"
    while IFS= read -r lab; do
        [[ -z "$lab" ]] && continue
        local lab_lc
        lab_lc="$(printf '%s' "$lab" | tr '[:upper:]' '[:lower:]')"
        if printf '%s' ",${labels_lc}," | grep -Fq ",${lab_lc},"; then
            echo -e "self_merge\tpromoted_label:${lab}"
            return 0
        fi
    done < <(printf '%s' "$policy" | jq -r '.self_merge.github_labels[]?')

    while IFS= read -r allow; do
        [[ -z "$allow" || "$allow" == "null" ]] && continue
        if [[ "$pr" == "$allow" ]]; then
            echo -e "self_merge\tpromoted_allowlist:${pr}"
            return 0
        fi
    done < <(printf '%s' "$policy" | jq -r '.self_merge.allow_pr_numbers[]?')

    # Auto-B: no product paths + size caps
    local nfiles delta max_files max_delta
    nfiles="$(printf '%s' "$files" | grep -c . || true)"
    [[ -z "$nfiles" ]] && nfiles=0
    delta=$((additions + deletions))
    max_files="$(printf '%s' "$policy" | jq -r '.self_merge.auto.max_changed_files // 8')"
    max_delta="$(printf '%s' "$policy" | jq -r '.self_merge.auto.max_delta_lines // 120')"

    if pmp_files_have_product "$files" "$policy"; then
        echo -e "${default_lane}\tproduct_paths"
        return 0
    fi
    if [[ "$nfiles" -gt "$max_files" ]]; then
        echo -e "${default_lane}\ttoo_many_files:${nfiles}>${max_files}"
        return 0
    fi
    if [[ "$delta" -gt "$max_delta" ]]; then
        echo -e "${default_lane}\ttoo_large_delta:${delta}>${max_delta}"
        return 0
    fi
    if [[ "$nfiles" -eq 0 ]]; then
        echo -e "${default_lane}\tno_files"
        return 0
    fi
    echo -e "self_merge\tauto_nonproduct"
    return 0
}

# pmp_action_for_lane LANE → statusAction fragment for clean PRs
pmp_action_for_lane() {
    case "$1" in
        self_merge) echo "full green - self-merge eligible (low-impact)" ;;
        *) echo "full green - wait on tiann" ;;
    esac
}
