#!/usr/bin/env bash
# pr-merge-policy.sh — estate overlay: chip stays health; lane is local policy.
#
# Chip status (clean/pending/…) stays generic/upstreamable.
# This lib answers: given a *clean* PR, is it lane A (wait maintainer) or
# lane B (collaborator self-merge eligible)?
#
# Auto-B is size-capped only (files + delta). Path kind (product vs tests)
# is NOT a hard reject — "because product" was retired 2026-08-09. Oversized
# or judgment-call PRs still need human promote via GitHub label or allowlist.
#
# Size caps ignore unit/spec test paths (*.test.*, *.spec.*, __tests__/):
# those inflate "how thoroughly we tested," not blast radius. Pure test-only
# PRs (#1268 class) remain auto-B. Docs still count.
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

# Return 0 if PATH is a unit/spec test (excluded from auto-B size caps).
pmp_is_test_path() {
    local p="${1:-}"
    case "$p" in
        *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.test.mjs|*.test.cjs) return 0 ;;
        *.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx|*.spec.mjs|*.spec.cjs) return 0 ;;
        */__tests__/*|*/__mocks__/*) return 0 ;;
        *) return 1 ;;
    esac
}

# Filter newline-separated paths to non-test paths (stdout).
pmp_product_files() {
    local files="$1" line
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        if pmp_is_test_path "$line"; then
            continue
        fi
        printf '%s\n' "$line"
    done < <(printf '%s' "$files")
}

# pmp_classify POLICY_JSON PR_NUMBER FILES_NL ADDITIONS DELETIONS LABELS_CSV
#   [PRODUCT_ADDITIONS PRODUCT_DELETIONS]
#
# ADDITIONS/DELETIONS are PR totals (may include tests). When PRODUCT_* are
# passed (non-empty), those are used for the delta cap instead — callers that
# have per-file stats should sum non-test files only.
#
# Prints: lane<TAB>reason
#   lane: maintainer | self_merge
#   reason: short machine token
pmp_classify() {
    local policy="$1" pr="$2" files="$3" additions="${4:-0}" deletions="${5:-0}" labels="${6:-}"
    local product_additions="${7:-}" product_deletions="${8:-}"
    local default_lane
    default_lane="$(printf '%s' "$policy" | jq -r '.default_lane // "maintainer"')"

    # Human promote: label or allowlist (covers oversized / judgment-call PRs)
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

    # Auto-B: size caps on product surface only (tests excluded)
    local nfiles_all nfiles delta max_files max_delta product_files
    nfiles_all="$(printf '%s' "$files" | grep -c . || true)"
    [[ -z "$nfiles_all" ]] && nfiles_all=0
    product_files="$(pmp_product_files "$files")"
    nfiles="$(printf '%s' "$product_files" | grep -c . || true)"
    [[ -z "$nfiles" ]] && nfiles=0

    if [[ -n "$product_additions" && -n "$product_deletions" ]]; then
        delta=$((product_additions + product_deletions))
    else
        delta=$((additions + deletions))
    fi

    max_files="$(printf '%s' "$policy" | jq -r '.self_merge.auto.max_changed_files // 8')"
    max_delta="$(printf '%s' "$policy" | jq -r '.self_merge.auto.max_delta_lines // 120')"

    # Pure test-only PR (#1268 class): no product files, but files exist → auto-B
    if [[ "$nfiles" -eq 0 && "$nfiles_all" -gt 0 ]]; then
        echo -e "self_merge\tauto_tests_only"
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
    echo -e "self_merge\tauto_size"
    return 0
}

# pmp_action_for_lane LANE → statusAction fragment for clean PRs
pmp_action_for_lane() {
    case "$1" in
        self_merge) echo "full green - self-merge eligible (low-impact)" ;;
        *) echo "full green - wait on tiann" ;;
    esac
}
