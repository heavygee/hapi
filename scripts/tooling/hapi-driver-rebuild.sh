#!/usr/bin/env bash
# Rebuild ~/coding/hapi/driver from config/driver-manifest.yaml (tracked in fork)
#
# ~/coding/hapi/driver is READ-ONLY between rebuilds — this script is the only
# supported way to change it. Hand-edits and cp-from-other-worktrees are forbidden.
#
# Post-2026-06-01 folder reorg: driver lives at ~/coding/hapi/driver (worktree
# under the canonical hapi/worktrees area), not ~/coding/hapi-driver. Override
# with HAPI_DRIVER env if needed.
#
# Usage:
#   hapi-driver-rebuild              # rebuild only (no hub restart)
#   hapi-driver-rebuild --build-web  # also rebuild web/dist
#   hapi-driver-rebuild --verify     # run typecheck + test after merge
#   hapi-driver-rebuild --activate   # swing hapi-active + restart hub (DESTRUCTIVE to live sessions)
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
if [[ "${HAPI_SKIP_DRIVER_LOCK:-}" != "1" ]]; then
    driver_status_init
    driver_status_acquire rebuild
    driver_status_begin rebuild "${ORIG_ARGS[@]}"
    trap 'driver_status_end rebuild "$?" head_sha="$(git -C "$DRIVER" rev-parse --short HEAD 2>/dev/null || echo unknown)" head_subject="$(git -C "$DRIVER" log -1 --format=%s 2>/dev/null || echo unknown)"' EXIT
fi

# shellcheck source=lib/driver-rebuild-agent-guard.sh
source "$LIB_DIR/driver-rebuild-agent-guard.sh"
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

if [[ -d "$DRIVER" ]] && [[ -n "$(git -C "$DRIVER" status --porcelain)" ]]; then
    echo "WARNING: $DRIVER has local changes — rebuild will reset the tree (stash or commit them elsewhere first)." >&2
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

echo "Resetting $DRIVER to $base_ref ($layer_count layer(s))..."
git -C "$DRIVER" checkout -B "$DRIVER_BRANCH" "$base_ref"

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

    echo "Layer $((i + 1))/$layer_count: merging $merge_ref ..."
    if ! git -C "$DRIVER" merge --no-edit "$merge_ref"; then
        # `git merge` exits 1 on any conflict, even when git rerere then
        # auto-resolves and stages everything. Detect that case: if no
        # unmerged paths remain (and no conflict markers leaked through),
        # commit the rerere-replay and continue. This is the whole point
        # of rerere-train.sh - the operator already taught git how to
        # resolve these collisions on a prior rebuild.
        unmerged="$(git -C "$DRIVER" diff --name-only --diff-filter=U 2>/dev/null)"
        markers="$(git -C "$DRIVER" grep -lE '^<<<<<<< |^>>>>>>> ' 2>/dev/null || true)"
        if [[ -z "$unmerged" && -z "$markers" ]]; then
            echo "Layer $((i + 1))/$layer_count: conflicts auto-resolved by git rerere; committing replay"
            git -C "$DRIVER" commit --no-edit --no-verify -q
            continue
        fi
        echo "ERROR: merge conflict merging $merge_ref into $DRIVER_BRANCH" >&2
        echo "       unmerged: $(echo "$unmerged" | wc -l) file(s); markers: $(echo "$markers" | wc -l) file(s)" >&2
        echo "Resolve in $DRIVER, commit, or fix manifest order." >&2
        exit 1
    fi
done

echo "Driver HEAD: $(git -C "$DRIVER" log -1 --oneline)"

# Post-merge heal: garden + share-target layers can leave a duplicate /share route
# that breaks vite ("shareRoute has already been declared"). Thin soup layers cannot
# reliably carry this delete across rematerializes (tip would be fat). Heal in-tree.
ROUTER="$DRIVER/web/src/router.tsx"
if [[ -f "$ROUTER" ]]; then
    share_decls="$(grep -c '^const shareRoute = createRoute' "$ROUTER" || true)"
    if [[ "${share_decls:-0}" -gt 1 ]]; then
        echo "Post-merge heal: deduping $share_decls shareRoute declarations in web/src/router.tsx ..."
        python3 - "$ROUTER" <<'PY'
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
        git -C "$DRIVER" add web/src/router.tsx
        git -C "$DRIVER" commit --no-edit --no-verify -q -m "fix(soup): dedupe shareRoute after garden/share layer merge"
        echo "Driver HEAD: $(git -C "$DRIVER" log -1 --oneline)"
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
            if git -C "$DRIVER" apply --check -3 "$patch" 2>/dev/null; then
                git -C "$DRIVER" apply -3 "$patch"
                git -C "$DRIVER" add -A
                if git -C "$DRIVER" diff --cached --quiet; then
                    echo "  applied $(basename "$patch") (no tree change)"
                else
                    git -C "$DRIVER" commit --no-edit --no-verify -q -m "fix(soup): apply heal $(basename "$patch")"
                    echo "  applied $(basename "$patch")"
                fi
            else
                echo "  skip $(basename "$patch") (already applied or does not apply cleanly)"
            fi
        done
        echo "Driver HEAD: $(git -C "$DRIVER" log -1 --oneline)"
    fi
fi

VERIFY_SCRIPT="$PRIMARY/scripts/tooling/verify-soup-web-dist.mjs"

if [[ "$BUILD_WEB" -eq 1 ]] || [[ ! -f "$DRIVER/web/dist/index.html" ]]; then
    echo "Building web (atomic swap + stamp)..."
    # shellcheck source=lib/build-web-atomic.sh
    source "$LIB_DIR/build-web-atomic.sh"
    build_web_atomic "$DRIVER"

    if [[ -f "$VERIFY_SCRIPT" ]]; then
        echo "Verifying web/dist matches driver web/src..."
        if ! "$BUN" run "$VERIFY_SCRIPT" "$DRIVER" "$MANIFEST" "$PRIMARY"; then
            echo "ERROR: web/dist verify failed after build — rolling back to dist.prev" >&2
            if [[ -d "$DRIVER/web/dist.prev" ]]; then
                rm -rf "$DRIVER/web/dist"
                mv "$DRIVER/web/dist.prev" "$DRIVER/web/dist"
                echo "Rolled back to previous dist bundle." >&2
            fi
            exit 1
        fi
    fi
elif [[ -f "$VERIFY_SCRIPT" ]] && [[ -f "$DRIVER/web/dist/index.html" ]]; then
    echo "Checking web/dist freshness vs merged driver HEAD..."
    if ! "$BUN" run "$VERIFY_SCRIPT" "$DRIVER" "$MANIFEST" "$PRIMARY"; then
        echo "" >&2
        echo "ERROR: driver/integration advanced but web/dist is stale (2026-06-28 class)." >&2
        echo "       Re-run: hapi-driver-rebuild --build-web --verify" >&2
        echo "       Or:     hapi-driver-build-web" >&2
        exit 1
    fi
fi

if [[ "$VERIFY" -eq 1 ]]; then
    echo "Running typecheck..."
    (cd "$DRIVER" && "$BUN" typecheck)
    HOTFILES="$PRIMARY/scripts/tooling/hapi-soup-hotfiles-check.mjs"
    if [[ -f "$HOTFILES" ]]; then
        echo "Checking soup hot-file consistency (syncEngine vs rpcGateway)..."
        "$BUN" run "$HOTFILES" "$DRIVER"
    fi
    echo "Running tests..."
    (cd "$DRIVER" && "$BUN" run test)
    STAMP="${HAPI_DRIVER_VERIFY_STAMP:-$HOME/.config/hapi/driver-verify-stamp}"
    mkdir -p "$(dirname "$STAMP")"
    git -C "$DRIVER" rev-parse HEAD >"$STAMP"
    echo "Verify stamp: $STAMP ($(cat "$STAMP" | head -c 12)…)"
fi

echo ""
echo "Driver rebuild complete: $DRIVER @ $(git -C "$DRIVER" rev-parse --short HEAD)"
echo "Manifest: $MANIFEST"
echo "Active hub: $(readlink -f "$HOME/coding/hapi/active" 2>/dev/null || echo '(no symlink)')"
hapi_print_feature_peer_reminders "driver rebuild @ $(git -C "$DRIVER" rev-parse --short HEAD) (web/dist — hard-reload dogfood)"

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
