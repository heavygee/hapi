#!/usr/bin/env bash
# Tip-forward merge-ref resolution for hapi-driver-rebuild.
#
# Soup compose base is the manifest `base:` (fork origin/main since 2026-10-06).
# Tip-forward must merge that base — not hard-prefer upstream/main — so fork
# utensils and finished fork product flow into soup by construction.
#
# Kill criterion: if tip-forward fights utensil add/add weekly, PRIMARY is the
# sole utensil writer; do not edit tooling inside the soup tip.

# driver_remat_tip_forward_merge_ref <base_ref>
# Prints the ref tip-forward should merge into WIP (empty = nothing to merge).
# Prefer the manifest base when it resolves; only use upstream/main when the
# base *is* upstream/main (legacy) or when base cannot be resolved.
driver_remat_tip_forward_merge_ref() {
    local base_ref="${1:-}"
    local repo="${2:-.}"

    if [[ -z "$base_ref" ]]; then
        return 1
    fi

    # Manifest base wins when it resolves (origin/main, main, upstream/main, …).
    if git -C "$repo" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
        printf '%s\n' "$base_ref"
        return 0
    fi

    # Legacy / missing base: fall back to upstream/main if present.
    if git -C "$repo" rev-parse --verify 'upstream/main^{commit}' >/dev/null 2>&1; then
        printf '%s\n' 'upstream/main'
        return 0
    fi

    return 1
}
