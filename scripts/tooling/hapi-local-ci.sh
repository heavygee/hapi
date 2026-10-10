#!/usr/bin/env bash
# hapi-local-ci.sh — local Test-equivalent CI for heavygee/hapi when GitHub
# Actions will not dispatch (billing / GitHub-controlled disable).
#
# Runs on oos-linux against a throwaway work dir, then posts a commit status
# via the GitHub Statuses API (context: oos-linux/test). That path still works
# when workflow_dispatch returns 422 "Actions has been disabled".
#
# Usage:
#   hapi-local-ci.sh                  # poll main tip; run if missing status
#   hapi-local-ci.sh --prs            # also open PRs updated in last N days
#   hapi-local-ci.sh --sha <sha>      # force one SHA
#   hapi-local-ci.sh --once           # single poll pass (for systemd/cron)
#   hapi-local-ci.sh --dry-run        # print candidates only
#
# Env:
#   HAPI_LOCAL_CI_REPO   default heavygee/hapi
#   HAPI_LOCAL_CI_ROOT   default /work/hapi-local-ci
#   HAPI_LOCAL_CI_STATE  default ~/.local/state/hapi-local-ci
#   HAPI_LOCAL_CI_SKIP_E2E=1   skip playwright e2e (faster smoke)
#   HAPI_LOCAL_CI_PR_DAYS      default 3 (with --prs)
set -euo pipefail

REPO="${HAPI_LOCAL_CI_REPO:-heavygee/hapi}"
ROOT="${HAPI_LOCAL_CI_ROOT:-/work/hapi-local-ci}"
STATE="${HAPI_LOCAL_CI_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hapi-local-ci}"
CONTEXT="oos-linux/test"
WORKDIR="$ROOT/work"
LOGDIR="$ROOT/logs"
FORCE_SHA=""
ONCE=0
DRY=0
WITH_PRS=0
PR_DAYS="${HAPI_LOCAL_CI_PR_DAYS:-3}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --sha) FORCE_SHA="${2:?}"; shift 2 ;;
        --once) ONCE=1; shift ;;
        --dry-run) DRY=1; shift ;;
        --prs) WITH_PRS=1; shift ;;
        -h|--help)
            sed -n '2,22p' "$0"
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

mkdir -p "$STATE" "$LOGDIR" "$ROOT"
LOCK="$ROOT/hapi-local-ci.lock"
# Stale pending older than this many seconds is ignored (crashed runner).
PENDING_MAX_AGE="${HAPI_LOCAL_CI_PENDING_MAX_AGE:-7200}"

need_gh() {
    command -v gh >/dev/null || { echo "gh required" >&2; exit 1; }
    command -v bun >/dev/null || { echo "bun required" >&2; exit 1; }
    command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
}

# Prints: state\tcreated_at_epoch (or empty)
status_row() {
    local sha="$1"
    gh api "repos/$REPO/commits/$sha/statuses" 2>/dev/null \
        | jq -r --arg ctx "$CONTEXT" '
            [.[] | select(.context == $ctx)]
            | sort_by(.created_at) | reverse
            | .[0]
            | if . == null then empty
              else "\(.state)\t\(.created_at | fromdateiso8601)"
              end
          ' \
        || true
}

status_for() {
    local sha="$1"
    local row state created now age
    row="$(status_row "$sha")"
    [[ -z "$row" ]] && { echo ""; return; }
    state="${row%%$'\t'*}"
    created="${row#*$'\t'}"
    if [[ "$state" == "pending" ]]; then
        now="$(date +%s)"
        age=$((now - created))
        if (( age > PENDING_MAX_AGE )); then
            echo ""  # treat as missing
            return
        fi
    fi
    echo "$state"
}

post_status() {
    local sha="$1" state="$2" desc="$3" target="${4:-}"
    local args=(-f state="$state" -f context="$CONTEXT" -f description="$desc")
    [[ -n "$target" ]] && args+=(-f target_url="$target")
    gh api -X POST "repos/$REPO/statuses/$sha" "${args[@]}" >/dev/null
}

candidates() {
    if [[ -n "$FORCE_SHA" ]]; then
        echo "$FORCE_SHA"
        return
    fi
    {
        gh api "repos/$REPO/commits/main" --jq .sha
        if [[ "$WITH_PRS" == "1" ]]; then
            # Only recently touched PR heads — full open list is a multi-hour backlog.
            gh api "repos/$REPO/pulls?state=open&per_page=30&sort=updated&direction=desc" \
                | jq -r --argjson days "$PR_DAYS" '
                    .[]
                    | select((now - (.updated_at | fromdateiso8601)) < ($days * 86400))
                    | .head.sha
                '
        fi
    } | awk 'NF && !seen[$0]++'
}

run_sha() {
    local sha="$1"
    local log="$LOGDIR/${sha}.log"
    local clone_url="https://github.com/${REPO}.git"

    echo "[hapi-local-ci] running $sha → $log"
    post_status "$sha" pending "oos-linux local Test running…"

    rm -rf "$WORKDIR"
    mkdir -p "$WORKDIR"
    # Shallow clone then fetch exact SHA (works for PR heads).
    git clone --filter=blob:none --depth=1 "$clone_url" "$WORKDIR" >>"$log" 2>&1
    (
        cd "$WORKDIR"
        git fetch --depth=1 origin "$sha" >>"$log" 2>&1
        git checkout --detach "$sha" >>"$log" 2>&1

        bun install --frozen-lockfile
        bun typecheck
        node --test .github/scripts/pr-review.test.cjs

        if [[ "${HAPI_LOCAL_CI_SKIP_E2E:-0}" != "1" ]]; then
            bunx playwright install --with-deps chromium
            docker pull mcr.microsoft.com/powershell:latest
            bun run test:e2e -- \
                terminal-wrap-fidelity.spec.ts \
                composer-copy.spec.ts \
                session-list-scroll.spec.ts \
                cold-initial-tail.spec.ts \
                scrollbar-auto-hide.spec.ts
        fi

        bun run test
        bun run --cwd cli test -- src/codex/utils/codexMcpProxy.test.ts
        bun run test:cli:integration
    ) >>"$log" 2>&1
}

process_sha() {
    local sha="$1"
    local cur
    cur="$(status_for "$sha")"
    # --sha forces a rerun even when success/pending.
    if [[ -z "$FORCE_SHA" && ( "$cur" == "success" || "$cur" == "pending" ) ]]; then
        echo "[hapi-local-ci] skip $sha (status=$cur)"
        return 0
    fi
    if [[ "$DRY" == "1" ]]; then
        echo "[hapi-local-ci] would run $sha (current=$cur)"
        return 0
    fi

    local rc=0
    set +e
    run_sha "$sha"
    rc=$?
    set -e

    if [[ $rc -eq 0 ]]; then
        post_status "$sha" success "oos-linux local Test passed"
        echo "[hapi-local-ci] PASS $sha"
        echo "$sha $(date -u +%Y-%m-%dT%H:%M:%SZ) success" >>"$STATE/history.log"
    else
        post_status "$sha" failure "oos-linux local Test failed (see $LOGDIR/${sha}.log)"
        echo "[hapi-local-ci] FAIL $sha (rc=$rc)"
        echo "$sha $(date -u +%Y-%m-%dT%H:%M:%SZ) failure" >>"$STATE/history.log"
    fi
    return 0
}

main() {
    need_gh
    exec 9>"$LOCK"
    if ! flock -n 9; then
        echo "[hapi-local-ci] another run holds $LOCK — exit"
        return 0
    fi

    local sha
    while read -r sha; do
        [[ -z "$sha" ]] && continue
        process_sha "$sha"
    done < <(candidates)

    if [[ "$ONCE" == "1" || -n "$FORCE_SHA" ]]; then
        return 0
    fi
    # Interactive / long-poll mode: sleep and loop (keep the flock).
    while true; do
        sleep "${HAPI_LOCAL_CI_INTERVAL:-120}"
        while read -r sha; do
            [[ -z "$sha" ]] && continue
            process_sha "$sha"
        done < <(candidates)
    done
}

main "$@"
