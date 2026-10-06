#!/usr/bin/env bash
# Tip-forward merge-ref resolution for hapi-driver-rebuild.
#
# Soup compose base is the manifest `base:` (fork origin/main since 2026-10-06).
# Tip-forward must merge that base — not hard-prefer upstream/main — so fork
# utensils and finished fork product flow into soup by construction.
#
# Kill criterion: if tip-forward fights utensil add/add weekly, PRIMARY is the
# sole utensil writer; do not edit tooling inside the soup tip.
#
# Explicit bases never silently fall back to upstream/main (2026-10-06 Codex on
# #213): a missing origin/main would otherwise promote soup without fork-only
# commits after layers were retired on the assumption the base supplies them.

# driver_remat_tip_forward_merge_ref <base_ref> [repo]
# Prints the ref tip-forward should merge into WIP.
# Returns 0 with the base ref when it resolves.
# Returns 0 with upstream/main only when the configured base *is* upstream/main.
# Returns 1 when an explicit non-upstream base cannot resolve (hard fail — no substitute).
driver_remat_tip_forward_merge_ref() {
    local base_ref="${1:-}"
    local repo="${2:-.}"

    if [[ -z "$base_ref" ]]; then
        return 1
    fi

    if git -C "$repo" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
        printf '%s\n' "$base_ref"
        return 0
    fi

    # Legacy recipe only: base literally upstream/main may resolve after fetch.
    if [[ "$base_ref" == "upstream/main" ]]; then
        if git -C "$repo" rev-parse --verify 'upstream/main^{commit}' >/dev/null 2>&1; then
            printf '%s\n' 'upstream/main'
            return 0
        fi
    fi

    # Explicit fork base (origin/main, main, …) must not substitute upstream.
    return 1
}
