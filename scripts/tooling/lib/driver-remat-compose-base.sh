#!/usr/bin/env bash
# Validate manifest compose base after fetch (sourced by hapi-driver-rebuild).
#
# Codex #213: stale origin/main (unfetched / local main ahead unpushed) must
# refuse remat — not silently compose on an old base after layers were retired.

# driver_remat_validate_compose_base <repo> <base_ref>
# Returns 0 when base is safe to compose. Prints Base: line to stdout.
# Returns 1 with ERROR on stderr when base is missing or local main is ahead
# of an origin/* base (unpushed fork tip).
driver_remat_validate_compose_base() {
    local repo="${1:?}"
    local base_ref="${2:?}"

    if [[ "$base_ref" == origin/* ]]; then
        if ! git -C "$repo" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
            echo "ERROR: manifest base '$base_ref' did not resolve after fetch origin" >&2
            echo "       Push/fetch the fork tip, or fix config/driver-manifest.yaml base:." >&2
            return 1
        fi
        if git -C "$repo" show-ref --verify --quiet refs/heads/main; then
            local stale_ahead
            stale_ahead="$(git -C "$repo" rev-list --count "${base_ref}..main" 2>/dev/null || echo 0)"
            if [[ "${stale_ahead:-0}" -gt 0 ]]; then
                echo "ERROR: local main is ${stale_ahead} commit(s) ahead of $base_ref" >&2
                echo "       Push fork main (git push origin main) before remat so the" >&2
                echo "       compose base includes those commits — layers may already" >&2
                echo "       have been retired on the assumption the base supplies them." >&2
                return 1
            fi
        fi
    fi

    if git -C "$repo" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
        echo "Base: $base_ref @ $(git -C "$repo" log -1 --oneline "$base_ref")"
        return 0
    fi

    if [[ "$base_ref" == "upstream/main" ]] \
        && git -C "$repo" rev-parse --verify 'upstream/main^{commit}' >/dev/null 2>&1; then
        echo "Base: upstream/main @ $(git -C "$repo" log -1 --oneline upstream/main)"
        return 0
    fi

    echo "ERROR: manifest base '$base_ref' does not resolve" >&2
    return 1
}
