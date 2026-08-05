# Fat / moved layer tip gate for tip-forward remat (sourced by hapi-driver-rebuild).
#
# Probe 2026-08-05: tip-forward is cheap for thin new layers, but absorbing a
# rebased fat tip (e.g. hub-runner-version-governance: 97 commits / 95 files)
# recreates full-recipe pain. Refuse those until the layer owner re-thins onto tip.
#
# Tunables:
#   HAPI_REMAT_LAYER_MAX_COMMITS  default 20  (non-merge commits tip..layer)
#   HAPI_REMAT_LAYER_MAX_FILES    default 40  (files changed tip..layer vs merge-base)
#   HAPI_REMAT_ABSORB_FAT=1       Meta override: allow absorb (still warn)

driver_remat_layer_gate() {
    local remat_wt="${1:?}"
    local tip_sha="${2:?}"
    local layer_ref="${3:?}"
    local max_commits="${HAPI_REMAT_LAYER_MAX_COMMITS:-20}"
    local max_files="${HAPI_REMAT_LAYER_MAX_FILES:-40}"
    local base commits files

    if ! git -C "$remat_wt" rev-parse --verify "${layer_ref}^{commit}" >/dev/null 2>&1; then
        echo "ERROR: layer gate: cannot resolve $layer_ref" >&2
        return 2
    fi

    base="$(git -C "$remat_wt" merge-base "$tip_sha" "$layer_ref" 2>/dev/null || true)"
    if [[ -z "$base" ]]; then
        echo "ERROR: layer gate: no merge-base between tip and $layer_ref" >&2
        return 2
    fi

    commits="$(git -C "$remat_wt" rev-list --count --no-merges "${tip_sha}..${layer_ref}" 2>/dev/null || echo 0)"
    files="$(git -C "$remat_wt" diff --name-only "${base}..${layer_ref}" 2>/dev/null | wc -l | tr -d ' ')"

    if [[ "$commits" -le "$max_commits" && "$files" -le "$max_files" ]]; then
        return 0
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "ERROR: layer tip is too fat for tip-forward absorb" >&2
    echo "       layer:    $layer_ref" >&2
    echo "       commits:  $commits non-merge (max $max_commits) tip..layer" >&2
    echo "       files:    $files changed vs merge-base (max $max_files)" >&2
    echo "       Re-thin onto current soup tip / upstream, or open a driver/<feature>" >&2
    echo "       union tip that merges clean. Do not full-recipe remat to 'force it'." >&2
    if [[ "${HAPI_REMAT_ABSORB_FAT:-}" == "1" ]]; then
        echo "NOTE: HAPI_REMAT_ABSORB_FAT=1 — allowing absorb anyway (Meta override)" >&2
        return 0
    fi
    echo "       Meta override (wedged): HAPI_REMAT_ABSORB_FAT=1" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    return 1
}
