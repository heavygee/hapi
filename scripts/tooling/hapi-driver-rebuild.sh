#!/usr/bin/env bash
# Rebuild ~/coding/hapi/driver from config/driver-manifest.yaml (tracked in fork)
#
# ~/coding/hapi/driver is READ-ONLY between rebuilds — this script is the only
# supported way to change it. Hand-edits and cp-from-other-worktrees are forbidden.
#
# Atomic remat (2026-07-30): layers+heals merge on branch driver/integration-wip
# in worktrees/driver-remat. Live driver/integration moves only after that succeeds.
# Merge conflict → live tip unchanged; resolve in the remat worktree. Post-promote
# verify/build failure → live tip restored to the pre-remat SHA (dist also rolls
# back via dist.prev when applicable).
#
# Post-2026-06-01 folder reorg: driver lives at ~/coding/hapi/driver (worktree
# under the canonical hapi/worktrees area), not ~/coding/hapi-driver. Override
# with HAPI_DRIVER env if needed.
#
# Usage:
#   hapi-driver-rebuild              # rebuild; patient hapi-restart-hub when hub/cli/shared changed
#   hapi-driver-rebuild --build-web  # also rebuild web/dist
#   hapi-driver-rebuild --verify     # run typecheck + test after merge
#   hapi-driver-rebuild --activate   # swing hapi-active + restart hub (DESTRUCTIVE to live sessions)
#
# Post-remat restart: after a successful promote, if hub/cli/shared changed vs the
# pre-remat tip, runs patient hapi-restart-hub (hub + runner). Web-only remats
# skip restart (hard-reload dogfood). Opt out: HAPI_DRIVER_NO_RESTART=1
#
set -euo pipefail

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DRIVER="${HAPI_DRIVER:-$HOME/coding/hapi/driver}"
LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/hapi-manifest-path.sh
source "$LIB_DIR/hapi-manifest-path.sh"
# shellcheck source=lib/hapi-feature-peer-reminders.sh
source "$LIB_DIR/hapi-feature-peer-reminders.sh"
MANIFEST="$(hapi_manifest_path "$PRIMARY")"
PARSE="$PRIMARY/scripts/tooling/parse-driver-manifest.mjs"
DRIVER_BRANCH="${HAPI_DRIVER_BRANCH:-driver/integration}"
BUN="${BUN:-$HOME/.bun/bin/bun}"

ORIG_ARGS=("$@")
BUILD_WEB=0
VERIFY=0
ACTIVATE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build-web) BUILD_WEB=1; shift ;;
        --verify) VERIFY=1; shift ;;
        --activate) ACTIVATE=1; shift ;;
        -h|--help)
            sed -n '2,12p' "$0"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

# Concurrency guard + status reporting (see lib/driver-status.sh).
# Bypassable: HAPI_SKIP_DRIVER_LOCK=1 (testing only -- corrupts driver tree
# if two rebuilds collide).
LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/driver-status.sh
source "$LIB_DIR/driver-status.sh"
# shellcheck source=lib/driver-remat-hold.sh
source "$LIB_DIR/driver-remat-hold.sh"
# Escalation hold blocks remat for everyone except the designated owner.
# Not skipped by HAPI_SKIP_DRIVER_LOCK (that only bypasses the flock).
driver_remat_hold_require_clear_or_owner "hapi-driver-rebuild"
# Single-writer lease: even owner-labelled sessions defer to the one live holder.
driver_remat_lease_require "hapi-driver-rebuild"
driver_remat_lease_heartbeat_bg_start
if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" != "1" ]]; then
    driver_status_init
    driver_status_acquire rebuild
    driver_status_begin rebuild "${ORIG_ARGS[@]}"
    _hapi_driver_rebuild_on_exit() {
        local rc=$?
        driver_remat_lease_teardown
        driver_status_end rebuild "$rc" \
            head_sha="$(git -C "$DRIVER" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
            head_subject="$(git -C "$DRIVER" log -1 --format=%s 2>/dev/null || echo unknown)"
        exit "$rc"
    }
    trap '_hapi_driver_rebuild_on_exit' EXIT
else
    trap 'driver_remat_lease_teardown' EXIT
fi

# shellcheck source=lib/driver-rebuild-agent-guard.sh
source "$LIB_DIR/driver-rebuild-agent-guard.sh"
# shellcheck source=lib/driver-remat-atomic.sh
source "$LIB_DIR/driver-remat-atomic.sh"
driver_rebuild_agent_guard "$BUILD_WEB" || exit 1

if [[ ! -f "$MANIFEST" ]]; then
    echo "ERROR: manifest not found: $MANIFEST" >&2
    echo "Canonical path: $PRIMARY/config/driver-manifest.yaml (git pull origin main)" >&2
    echo "Legacy override: ~/.config/hapi/driver-manifest.yaml or HAPI_DRIVER_MANIFEST=" >&2
    exit 1
fi

if [[ ! -x "$PARSE" ]] && [[ ! -f "$PARSE" ]]; then
    echo "ERROR: parser missing: $PARSE" >&2
    exit 1
fi

mkdir -p "$(dirname "$MANIFEST")"

echo "Fetching upstream..."
git -C "$PRIMARY" fetch upstream
upstream_tip="$(git -C "$PRIMARY" rev-parse upstream/main 2>/dev/null || true)"

SYNC_SCRIPT="$PRIMARY/scripts/tooling/hapi-sync-fork-main.sh"
if [[ -x "$SYNC_SCRIPT" ]]; then
    if ! "$SYNC_SCRIPT" --check-only 2>/dev/null; then
        echo "ERROR: fork main is behind upstream/main. Run: hapi-sync-fork-main && git push origin main" >&2
        exit 1
    fi
elif git -C "$PRIMARY" show-ref --verify --quiet refs/heads/main; then
    behind_main="$(git -C "$PRIMARY" rev-list --count main..upstream/main 2>/dev/null || echo 0)"
    if [[ "${behind_main:-0}" -gt 0 ]]; then
        echo "ERROR: $PRIMARY main is ${behind_main} commit(s) behind upstream/main" >&2
        echo "       Run: hapi-sync-fork-main" >&2
        exit 1
    fi
fi

# Atomic web swap leaves web/dist.prev (and sometimes dist.next). Those are
# generated artifacts — never soup source. Auto-clean so a prior --build-web
# does not abort the next rematerialize on "dirty driver".
if [[ -d "$DRIVER/web" ]]; then
    for gen in dist.prev dist.next; do
        if [[ -e "$DRIVER/web/$gen" ]]; then
            echo "Pre-clean: removing generated web/$gen from prior atomic swap"
            git -C "$DRIVER" checkout -- "web/$gen" 2>/dev/null || true
            git -C "$DRIVER" clean -fdq -- "web/$gen" 2>/dev/null || true
            rm -rf "$DRIVER/web/$gen"
        fi
    done
fi

if [[ -d "$DRIVER" ]] && [[ -n "$(git -C "$DRIVER" status --porcelain)" ]]; then
    echo "WARNING: $DRIVER has local changes — remat promotes a clean tip over them on success." >&2
    echo "         Only manifest-driven rebuilds belong on the driver tree. See docs/tooling/driver-soup.md" >&2
fi

if [[ ! -d "$DRIVER" ]]; then
    echo "Creating driver worktree at $DRIVER (branch $DRIVER_BRANCH)..."
    git -C "$PRIMARY" worktree add -b "$DRIVER_BRANCH" "$DRIVER" upstream/main
fi

if [[ ! -e "$DRIVER/hub/.env" ]]; then
    echo "Linking hub/.env → ~/.hapi/hub.env"
    ln -s "$HOME/.hapi/hub.env" "$DRIVER/hub/.env"
fi

manifest_json="$("$BUN" run "$PARSE" "$MANIFEST")"
base_ref="$(echo "$manifest_json" | jq -r '.base')"
layer_count="$(echo "$manifest_json" | jq '.layers | length')"

if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" != "1" ]]; then
    driver_status_set rebuild "manifest_layer_count=$layer_count"
fi

if echo "$manifest_json" | jq -e '.layers[] | select(.ref == "fix/web-scroll-guard-unwrap-race")' >/dev/null; then
    pr722_state="$(gh pr view 722 --repo "${HAPI_PR_REPO:-tiann/hapi}" --json state --jq '.state' 2>/dev/null || true)"
    if [[ "$pr722_state" == "MERGED" ]]; then
        echo "WARNING: upstream PR #722 is merged — drop fix/web-scroll-guard-unwrap-race from $MANIFEST" >&2
    fi
fi

if [[ -n "$upstream_tip" && "$base_ref" == "upstream/main" ]]; then
    echo "Base: upstream/main @ $(git -C "$PRIMARY" log -1 --oneline "$upstream_tip")"
fi

# Atomic remat: merge layers on WIP in a side worktree; only move live tip on success.
# Failed remat must leave driver/integration (= dogfood source) unchanged (2026-07-29).
#
# Default mode tip-forward (2026-08-05 probe): start at PREV_TIP, merge upstream if
# needed, skip ancestor layers, fat-tip gate on non-ancestors. Escape hatch:
# HAPI_REMAT_MODE=full-recipe (reset to upstream/base + replay every layer).
PREV_TIP="$(git -C "$DRIVER" rev-parse "$DRIVER_BRANCH" 2>/dev/null || git -C "$DRIVER" rev-parse HEAD)"
WIP_BRANCH="$(driver_remat_wip_branch "$DRIVER_BRANCH")"
PROMOTED=0
REMAT_MODE="$(driver_remat_mode)"
# shellcheck source=lib/driver-remat-layer-gate.sh
source "$LIB_DIR/driver-remat-layer-gate.sh"

echo "Atomic remat: live tip $DRIVER_BRANCH @ ${PREV_TIP:0:12} (unchanged until success)"
echo "Remat mode: $REMAT_MODE (override: HAPI_REMAT_MODE=tip-forward|full-recipe)"

START_REF="$base_ref"
if [[ "$REMAT_MODE" == "tip-forward" ]]; then
    if [[ -z "$PREV_TIP" ]]; then
        echo "WARNING: tip-forward requested but no PREV_TIP — falling back to full-recipe" >&2
        REMAT_MODE=full-recipe
    else
        START_REF="$PREV_TIP"
    fi
fi

echo "Preparing remat worktree for $WIP_BRANCH from $START_REF ($layer_count layer(s))..."
REMAT="$(driver_remat_prepare "$PRIMARY" "$WIP_BRANCH" "$START_REF")"

# Tip-forward: bring upstream/main in if tip has not absorbed it yet.
if [[ "$REMAT_MODE" == "tip-forward" ]]; then
    upstream_ref=""
    if git -C "$REMAT" rev-parse --verify upstream/main^{commit} >/dev/null 2>&1; then
        upstream_ref=upstream/main
    elif [[ "$base_ref" != "$PREV_TIP" ]] && git -C "$REMAT" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
        upstream_ref="$base_ref"
    fi
    if [[ -n "$upstream_ref" ]]; then
        if git -C "$REMAT" merge-base --is-ancestor "$upstream_ref" HEAD; then
            echo "Tip-forward: $upstream_ref already ancestor of WIP — skip"
        else
            echo "Tip-forward: merging $upstream_ref into WIP..."
            if ! git -C "$REMAT" merge --no-edit "$upstream_ref"; then
                unmerged="$(git -C "$REMAT" diff --name-only --diff-filter=U 2>/dev/null)"
                markers="$(git -C "$REMAT" grep -lE '^<<<<<<< |^>>>>>>> ' 2>/dev/null || true)"
                if [[ -z "$unmerged" && -z "$markers" ]]; then
                    git -C "$REMAT" commit --no-edit --no-verify -q
                else
                    echo "ERROR: merge conflict merging $upstream_ref into tip-forward WIP" >&2
                    driver_remat_fail_leave_wip "$REMAT" "$WIP_BRANCH" "$DRIVER_BRANCH" "$PREV_TIP" "$upstream_ref"
                    driver_remat_hold_set \
                        "merge conflict on $upstream_ref (tip-forward)" \
                        "$REMAT" "$PREV_TIP" "$WIP_BRANCH" "$upstream_ref"
                    exit 1
                fi
            fi
        fi
    fi
fi

resolve_merge_ref() {
    local type="$1" ref="$2"
    case "$type" in
        branch|integrate)
            if git -C "$PRIMARY" rev-parse --verify "${ref}^{commit}" >/dev/null 2>&1; then
                echo "$ref"
            else
                echo "ERROR: layer ref not found: $ref" >&2
                exit 1
            fi
            ;;
        pr)
            local head_branch pr_repo="${HAPI_PR_REPO:-tiann/hapi}"
            head_branch="$(gh pr view "$ref" --repo "$pr_repo" --json headRefName --jq '.headRefName' 2>/dev/null || true)"
            if [[ -z "$head_branch" || "$head_branch" == "null" ]]; then
                echo "ERROR: could not resolve PR #$ref via gh (repo: $pr_repo)" >&2
                exit 1
            fi
            git -C "$PRIMARY" fetch origin "$head_branch" 2>/dev/null || true
            echo "origin/$head_branch"
            ;;
        *)
            echo "ERROR: unknown layer type: $type" >&2
            exit 1
            ;;
    esac
}

for i in $(seq 0 $((layer_count - 1))); do
    type="$(echo "$manifest_json" | jq -r ".layers[$i].type")"
    ref="$(echo "$manifest_json" | jq -r ".layers[$i].ref")"
    merge_ref="$(resolve_merge_ref "$type" "$ref")"

    if [[ "$REMAT_MODE" == "tip-forward" ]] \
        && git -C "$REMAT" merge-base --is-ancestor "$merge_ref" HEAD 2>/dev/null; then
        echo "Layer $((i + 1))/$layer_count: skip $merge_ref (already ancestor of tip-forward WIP)"
        continue
    fi

    if [[ "$REMAT_MODE" == "tip-forward" ]]; then
        # Refuse absorb ≠ abort remat. Tip already carries prior union content;
        # skip fat/moved tips so upstream tip-forward can still promote (WAVE CLEAR).
        # Layer owner must re-thin; Meta may HAPI_REMAT_ABSORB_FAT=1 to force.
        if ! driver_remat_layer_gate "$REMAT" HEAD "$merge_ref"; then
            echo "Layer $((i + 1))/$layer_count: SKIP $merge_ref (fat tip; tip-forward refuse absorb)"
            echo "       Re-thin onto current soup tip, then remat again to refresh this layer."
            continue
        fi
    fi

    echo "Layer $((i + 1))/$layer_count: merging $merge_ref ..."
    if ! git -C "$REMAT" merge --no-edit "$merge_ref"; then
        # `git merge` exits 1 on any conflict, even when git rerere then
        # auto-resolves and stages everything. Detect that case: if no
        # unmerged paths remain (and no conflict markers leaked through),
        # commit the rerere-replay and continue. This is the whole point
        # of rerere-train.sh - the operator already taught git how to
        # resolve these collisions on a prior rebuild.
        unmerged="$(git -C "$REMAT" diff --name-only --diff-filter=U 2>/dev/null)"
        markers="$(git -C "$REMAT" grep -lE '^<<<<<<< |^>>>>>>> ' 2>/dev/null || true)"
        if [[ -z "$unmerged" && -z "$markers" ]]; then
            echo "Layer $((i + 1))/$layer_count: conflicts auto-resolved by git rerere; committing replay"
            git -C "$REMAT" commit --no-edit --no-verify -q
            continue
        fi
        echo "ERROR: merge conflict merging $merge_ref into $WIP_BRANCH" >&2
        echo "       unmerged: $(echo "$unmerged" | wc -l) file(s); markers: $(echo "$markers" | wc -l) file(s)" >&2
        driver_remat_fail_leave_wip "$REMAT" "$WIP_BRANCH" "$DRIVER_BRANCH" "$PREV_TIP" "$merge_ref"
        driver_remat_hold_set \
            "merge conflict on $merge_ref" \
            "$REMAT" "$PREV_TIP" "$WIP_BRANCH" "$merge_ref"
        exit 1
    fi
done

echo "Remat WIP HEAD: $(git -C "$REMAT" log -1 --oneline)"

# Pre-promote heal failure: nothing is live yet, so leave the WIP for the owner
# to inspect and set the fail-closed hold (mirrors the merge-conflict path). This
# closes the gap where a heal that `--check` passes but `apply -3` conflicts (base
# drift), or a router-dedupe/python heal that errors, would otherwise die under
# `set -e` with no hold set, letting the next agent re-thrash the same broken soup.
heal_fail() {
    local reason="$1"
    echo "ERROR: $reason" >&2
    driver_remat_fail_leave_wip "$REMAT" "$WIP_BRANCH" "$DRIVER_BRANCH" "$PREV_TIP" "$reason"
    driver_remat_hold_set \
        "$reason" \
        "$REMAT" "$PREV_TIP" "$WIP_BRANCH" ""
    exit 1
}

# Post-merge heal: garden + share-target layers can leave a duplicate /share route
# that breaks vite ("shareRoute has already been declared"). Thin soup layers cannot
# reliably carry this delete across rematerializes (tip would be fat). Heal in-tree.
ROUTER="$REMAT/web/src/router.tsx"
if [[ -f "$ROUTER" ]]; then
    share_decls="$(grep -c '^const shareRoute = createRoute' "$ROUTER" || true)"
    if [[ "${share_decls:-0}" -gt 1 ]]; then
        echo "Post-merge heal: deduping $share_decls shareRoute declarations in web/src/router.tsx ..."
        if ! python3 - "$ROUTER" <<'PY'
import re, sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
pattern = re.compile(r"\nconst shareRoute = createRoute\(\{.*?\n\}\)\n", re.S)
matches = list(pattern.finditer(text))
if len(matches) < 2:
    raise SystemExit(0)
second = matches[1]
path.write_text(text[: second.start()] + text[second.end() :])
print(f"  removed duplicate shareRoute block ({len(matches)} -> {len(matches) - 1})")
PY
        then
            heal_fail "shareRoute dedupe heal failed (web/src/router.tsx)"
        fi
        git -C "$REMAT" add web/src/router.tsx
        git -C "$REMAT" commit --no-edit --no-verify -q -m "fix(soup): dedupe shareRoute after garden/share layer merge" \
            || heal_fail "shareRoute dedupe commit failed"
        echo "Remat WIP HEAD: $(git -C "$REMAT" log -1 --oneline)"
    fi
fi

# Post-merge heal patches (tip fixes that rematerialize cannot express as thin layers).
# Ordered files under scripts/tooling/soup-heals/*.patch — apply with 3-way; skip if empty.
HEAL_DIR="$PRIMARY/scripts/tooling/soup-heals"
if [[ -d "$HEAL_DIR" ]]; then
    shopt -s nullglob
    heal_patches=("$HEAL_DIR"/*.patch)
    shopt -u nullglob
    if [[ ${#heal_patches[@]} -gt 0 ]]; then
        echo "Post-merge heal: applying ${#heal_patches[@]} patch(es) from soup-heals/ ..."
        for patch in "${heal_patches[@]}"; do
            if git -C "$REMAT" apply --check -3 "$patch" 2>/dev/null; then
                # `apply -3` can still leave conflicts even when `--check` passed
                # (3-way base drift). Tip-forward: warn-skip (probe: heals are mostly
                # no-ops / stale). Full-recipe: fail-closed (heal_fail).
                if ! git -C "$REMAT" apply -3 "$patch"; then
                    if [[ "$REMAT_MODE" == "tip-forward" ]]; then
                        echo "  WARN: skip $(basename "$patch") (apply -3 failed; tip-forward does not heal_fail)"
                        git -C "$REMAT" checkout -- . >/dev/null 2>&1 || true
                        git -C "$REMAT" clean -fdq >/dev/null 2>&1 || true
                        continue
                    fi
                    heal_fail "heal apply failed (3-way conflict): $(basename "$patch")"
                fi
                if git -C "$REMAT" grep -lE '^<<<<<<< |^>>>>>>> ' >/dev/null 2>&1; then
                    if [[ "$REMAT_MODE" == "tip-forward" ]]; then
                        echo "  WARN: skip $(basename "$patch") (left conflict markers; tip-forward)"
                        git -C "$REMAT" checkout -- . >/dev/null 2>&1 || true
                        git -C "$REMAT" clean -fdq >/dev/null 2>&1 || true
                        continue
                    fi
                    heal_fail "heal left conflict markers: $(basename "$patch")"
                fi
                git -C "$REMAT" add -A
                if git -C "$REMAT" diff --cached --quiet; then
                    echo "  skip $(basename "$patch") (no-op on WIP)"
                else
                    git -C "$REMAT" commit --no-edit --no-verify -q -m "fix(soup): apply heal $(basename "$patch")"
                    echo "  applied $(basename "$patch")"
                fi
            else
                echo "  skip $(basename "$patch") (already applied or does not apply cleanly)"
            fi
        done
        echo "Remat WIP HEAD: $(git -C "$REMAT" log -1 --oneline)"
    fi
fi

# Soup-critical hub route mounts (always — not only --verify). Tip-forward can
# warn-skip remount heals and still promote a tip that serves SPA HTML as the
# fleet CLI artifact (2026-08-07 toast storm). Fail closed before promote.
MOUNT_CHECK="$PRIMARY/scripts/tooling/hapi-soup-route-mounts-check.mjs"
if [[ -f "$MOUNT_CHECK" ]]; then
    echo "Checking soup-critical hub route mounts..."
    if ! "$BUN" run "$MOUNT_CHECK" "$REMAT"; then
        heal_fail "soup-critical route mounts missing (hapi-soup-route-mounts-check)"
    fi
fi

WIP_SHA="$(git -C "$REMAT" rev-parse HEAD)"
echo "Promoting live tip $DRIVER_BRANCH → ${WIP_SHA:0:12} (layers+heals OK)..."
driver_remat_promote "$DRIVER" "$DRIVER_BRANCH" "$WIP_SHA"
PROMOTED=1
echo "Driver HEAD: $(git -C "$DRIVER" log -1 --oneline)"

VERIFY_SCRIPT="$PRIMARY/scripts/tooling/verify-soup-web-dist.mjs"

# After promote: any hard failure restores live tip so dogfood source matches "no change on fail".
remat_rollback_live_tip() {
    local reason="${1:-post-promote failure}"
    if [[ "${PROMOTED:-0}" -eq 1 && -n "${PREV_TIP:-}" ]]; then
        echo "ERROR: $reason — rolling back live tip (atomic remat)" >&2
        driver_remat_restore_tip "$DRIVER" "$DRIVER_BRANCH" "$PREV_TIP"
        PROMOTED=0
    fi
    driver_remat_hold_set \
        "$reason" \
        "${REMAT:-}" "${PREV_TIP:-}" "${WIP_BRANCH:-}" ""
}

if [[ "$BUILD_WEB" -eq 1 ]] || [[ ! -f "$DRIVER/web/dist/index.html" ]]; then
    echo "Building web (atomic swap + stamp)..."
    # shellcheck source=lib/build-web-atomic.sh
    source "$LIB_DIR/build-web-atomic.sh"
    if ! build_web_atomic "$DRIVER"; then
        remat_rollback_live_tip "web build failed"
        exit 1
    fi

    if [[ -f "$VERIFY_SCRIPT" ]]; then
        echo "Verifying web/dist matches driver web/src..."
        if ! "$BUN" run "$VERIFY_SCRIPT" "$DRIVER" "$MANIFEST" "$PRIMARY"; then
            echo "ERROR: web/dist verify failed after build — rolling back to dist.prev" >&2
            if [[ -d "$DRIVER/web/dist.prev" ]]; then
                rm -rf "$DRIVER/web/dist"
                mv "$DRIVER/web/dist.prev" "$DRIVER/web/dist"
                echo "Rolled back to previous dist bundle." >&2
            fi
            remat_rollback_live_tip "web/dist verify failed"
            exit 1
        fi
    fi

    # verify-soup-web-dist alone missed session-route error boundaries (2026-08-04).
    # shellcheck source=lib/session-open-smoke-gate.sh
    source "$LIB_DIR/session-open-smoke-gate.sh"
    if ! driver_session_open_smoke_gate "$DRIVER"; then
        remat_rollback_live_tip "session-open-smoke failed"
        exit 1
    fi
elif [[ -f "$VERIFY_SCRIPT" ]] && [[ -f "$DRIVER/web/dist/index.html" ]]; then
    echo "Checking web/dist freshness vs merged driver HEAD..."
    if ! "$BUN" run "$VERIFY_SCRIPT" "$DRIVER" "$MANIFEST" "$PRIMARY"; then
        echo "" >&2
        echo "ERROR: driver/integration advanced but web/dist is stale (2026-06-28 class)." >&2
        echo "       Re-run: hapi-driver-rebuild --build-web --verify" >&2
        echo "       Or:     hapi-driver-build-web" >&2
        remat_rollback_live_tip "stale web/dist after promote"
        exit 1
    fi
fi

if [[ "$VERIFY" -eq 1 ]]; then
    # Tip-forward may land new workspace deps (e.g. #1392 proper-lockfile) that
    # remat WT already installed while live driver/node_modules stayed stale.
    # Typecheck/tests run against $DRIVER — refresh before gates (2026-08-07).
    echo "Ensuring driver dependencies (post-promote)..."
    if ! (cd "$DRIVER" && "$BUN" install); then
        remat_rollback_live_tip "bun install failed"
        exit 1
    fi
    echo "Running typecheck..."
    if ! (cd "$DRIVER" && "$BUN" typecheck); then
        remat_rollback_live_tip "typecheck failed"
        exit 1
    fi
    EXCISED="$PRIMARY/scripts/tooling/hapi-soup-excised-check.mjs"
    if [[ -f "$EXCISED" ]]; then
        # Guards the "dropped layer, code still present" class: a layer is
        # dropped to excise code, but other active layers re-carry it, so the
        # drop silently achieves nothing (#1473 fortress, 2026-08-17 -> 08-27).
        echo "Checking soup excision registry (dropped code not re-carried)..."
        if ! "$BUN" run "$EXCISED"; then
            remat_rollback_live_tip "soup excision check failed"
            exit 1
        fi
    fi
    HOTFILES="$PRIMARY/scripts/tooling/hapi-soup-hotfiles-check.mjs"
    if [[ -f "$HOTFILES" ]]; then
        echo "Checking soup hot-file consistency (syncEngine vs rpcGateway)..."
        if ! "$BUN" run "$HOTFILES" "$DRIVER"; then
            remat_rollback_live_tip "soup hotfiles check failed"
            exit 1
        fi
    fi
    echo "Running tests..."
    if ! (cd "$DRIVER" && "$BUN" run test); then
        remat_rollback_live_tip "tests failed"
        exit 1
    fi
    STAMP="${HAPI_DRIVER_VERIFY_STAMP:-$HOME/.config/hapi/driver-verify-stamp}"
    mkdir -p "$(dirname "$STAMP")"
    git -C "$DRIVER" rev-parse HEAD >"$STAMP"
    echo "Verify stamp: $STAMP ($(cat "$STAMP" | head -c 12)…)"
fi

# Successful remat by escalate owner clears any prior hold.
driver_remat_hold_clear_on_success

echo ""
echo "Driver rebuild complete: $DRIVER @ $(git -C "$DRIVER" rev-parse --short HEAD)"
echo "Manifest: $MANIFEST"
echo "Active hub: $(readlink -f "$HOME/coding/hapi/active" 2>/dev/null || echo '(no symlink)')"

# Hub process loads bun modules at start — remat updates driver/ on disk only.
# If tip gained /api/features (PR awareness) but the live hub still 404s, dogfood
# looks "chip-less" and a mid-stack hub without CONTRIBUTION_FIELDS can wipe refs.
# Incident 2026-07-30: remat finished 02:29; hub not restarted until 08:51.
if [[ -f "$DRIVER/hub/src/web/routes/features.ts" ]]; then
    features_code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 "http://127.0.0.1:3006/api/features" 2>/dev/null || echo 000)"
    if [[ "$features_code" != "200" && "$features_code" != "401" && "$features_code" != "403" ]]; then
        echo "" >&2
        echo "WARNING: driver tip has hub features route but GET /api/features → HTTP ${features_code}." >&2
        echo "         Live hub is skewed vs remat tip — run: hapi-restart-hub" >&2
        echo "         (Do not declare dogfood green until features responds; 2026-07-30 class.)" >&2
    fi
fi

hapi_print_feature_peer_reminders "driver rebuild @ $(git -C "$DRIVER" rev-parse --short HEAD) (web/dist — hard-reload dogfood)"

# Patient hub+runner restart when runtime code changed (2026-08-13: was manual-only).
if [[ "${PROMOTED:-0}" -eq 1 && -n "${PREV_TIP:-}" && -n "${WIP_SHA:-}" ]]; then
    # shellcheck source=lib/driver-remat-auto-restart.sh
    source "$LIB_DIR/driver-remat-auto-restart.sh"
    driver_remat_auto_restart_hub "$DRIVER" "$PREV_TIP" "$WIP_SHA"
fi

if [[ "$ACTIVATE" -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ACTIVATE: restarts hapi-hub + hapi-runner (kills sessions)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ -t 0 ]]; then
        read -rp "Proceed with hapi-use-worktree $DRIVER? [y/N] " yn
        [[ "${yn,,}" == "y" ]] || { echo "Skipped activate."; exit 0; }
    else
        echo "Non-interactive: skipping activate (re-run with TTY or use hapi-use-worktree manually)." >&2
        exit 0
    fi
    # Hand off to the switch script. The EXIT trap won't fire under exec, so
    # close the rebuild as successful here (head_sha is known good) and let
    # use-worktree own the switch lock + status from here on.
    if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" != "1" ]]; then
        driver_remat_lease_teardown
        driver_status_end rebuild 0 \
            head_sha="$(git -C "$DRIVER" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
            head_subject="$(git -C "$DRIVER" log -1 --format=%s 2>/dev/null || echo unknown)"
        trap - EXIT
        eval "exec ${_HAPI_LOCK_FD_REBUILD}>&-"
    fi
    exec hapi-use-worktree "$DRIVER"
fi

echo ""
echo "To swing live hub (restarts service — kills sessions):"
echo "  hapi-use-worktree $DRIVER"
