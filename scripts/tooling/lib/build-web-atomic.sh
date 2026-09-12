#!/usr/bin/env bash
# build_web_atomic DRIVER
# Build web/dist into dist.next, sanity-check, atomic swap to dist (prev preserved).
# Caller must set BUN (defaults to ~/.bun/bin/bun).
#
# HAPI_WEB_SWAP_DEFER=1 — build dist.next only; swap after hub restart via
# build_web_finish_deferred_swap (2026-09-11 @-mention split-deploy cliff).
#
# Note: the two-rename publish (`dist`→`dist.prev`, `dist.next`→`dist`) has a
# brief path gap. Vite builds into dist.next with live dist untouched until
# then; the gap is milliseconds. Session-route poison from a bad tip is gated
# separately by session-open-smoke-gate.sh (not this rename).

_build_web_regen_embed() {
    local driver="$1" dist="$2"
    local bun="${BUN:-$HOME/.bun/bin/bun}"
    local hub="$driver/hub"
    if [[ -f "$hub/package.json" ]] && grep -q '"generate:embedded-web-assets"' "$hub/package.json" 2>/dev/null; then
        echo "Regenerating hub embeddedAssets.generated.ts from $dist..."
        if ! (cd "$hub" && "$bun" run generate:embedded-web-assets); then
            echo "ERROR: embedded asset manifest regen failed after web swap" >&2
            return 1
        fi
    fi
    return 0
}

_build_web_swap_next_to_dist() {
    local driver="$1" next="$2"
    local web="$driver/web"
    local dist="$web/dist"
    local prev="$web/dist.prev"

    rm -rf "$prev"
    if [[ -d "$dist" ]] && [[ ! -L "$dist" ]]; then
        mv "$dist" "$prev"
    elif [[ -L "$dist" ]]; then
        rm -f "$dist"
    fi
    mv "$next" "$dist"

    local head_sha
    head_sha="$(git -C "$driver" rev-parse HEAD 2>/dev/null || echo unknown)"
    cat >"$dist/.hapi-build-meta.json" <<EOF
{"driverHead":"$head_sha","builtAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","builtBy":"build_web_atomic"}
EOF
    _build_web_regen_embed "$driver" "$dist"
}

build_web_atomic() {
    local driver="$1"
    local bun="${BUN:-$HOME/.bun/bin/bun}"
    local web="$driver/web"
    local dist="$web/dist"
    local next="$web/dist.next"
    local prev="$web/dist.prev"
    local defer="${HAPI_WEB_SWAP_DEFER:-}"

    if [[ ! -d "$web" ]]; then
        echo "ERROR: driver web dir not found: $web" >&2
        return 1
    fi

    if [[ ! -d "$driver/node_modules" ]]; then
        echo "Installing dependencies (first driver build)..."
        (cd "$driver" && "$bun" install)
    fi

    # shellcheck source=build-web-preflight.sh
    source "$(dirname "${BASH_SOURCE[0]}")/build-web-preflight.sh"
    if ! build_web_preflight; then
        return 1
    fi

    rm -rf "$next"
    if ! (cd "$web" && "$bun" x vite build --outDir dist.next); then
        echo "ERROR: vite build failed; live $dist untouched" >&2
        rm -rf "$next"
        return 1
    fi
    if [[ ! -f "$next/index.html" ]]; then
        echo "ERROR: build produced no $next/index.html; live $dist untouched" >&2
        rm -rf "$next"
        return 1
    fi
    cp "$next/index.html" "$next/404.html"

    if [[ "$defer" == "1" ]]; then
        local head_sha
        head_sha="$(git -C "$driver" rev-parse HEAD 2>/dev/null || echo unknown)"
        cat >"$next/.hapi-deferred-swap.json" <<EOF
{"driverHead":"$head_sha","builtAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","reason":"hub_restart_pending"}
EOF
        # Post-promote typecheck runs before swap; sync embed manifest to dist.next
        # so hub tsc does not read a stale embeddedAssets.generated.ts (2026-09-12).
        if ! _build_web_regen_embed "$driver" "$next"; then
            return 1
        fi
        echo "Web build ready in $next — swap deferred until hub restart (HAPI_WEB_SWAP_DEFER=1)" >&2
        echo "  Live $dist unchanged; hub-dependent web gates stay safe during patient drain." >&2
        return 0
    fi

    if ! _build_web_swap_next_to_dist "$driver" "$next"; then
        return 1
    fi

    echo "Web bundle swapped atomically: $dist"
    echo "Previous bundle: $prev (use hapi-driver-rollback-web to restore)"
}

# build_web_finish_deferred_swap DRIVER
# After patient hub restart: swap dist.next → dist if remat deferred the publish.
build_web_finish_deferred_swap() {
    local driver="$1"
    local web="$driver/web"
    local dist="$web/dist"
    local next="$web/dist.next"
    local marker="$next/.hapi-deferred-swap.json"

    [[ -f "$marker" && -f "$next/index.html" ]] || return 0

    echo "Finishing deferred web/dist swap (post hub restart)..."
    if ! _build_web_swap_next_to_dist "$driver" "$next"; then
        echo "ERROR: deferred web/dist swap failed — dist.next still at $next" >&2
        return 1
    fi
    rm -f "$marker"
    echo "Deferred web bundle now live: $dist (hard-reload dogfood browser)"
    return 0
}
