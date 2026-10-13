#!/usr/bin/env bash
# Fleet-seal dispatcher (#258) — per-target-type actions after a spoken seal.
# FORK-ONLY. Canon: docs/plans/2026-10-13-fleet-seal-contract.md
#
# Types (generic registry — not host-hardcoded):
#   estate-hub          — optional push-upgrade fan-out
#   standalone-layer-a  — GH channel already upserted; verify poll URL
#   cattle-vm-swap      — plan (default) or apply VM-swap when HAPI_FLEET_CATTLE_APPLY=1
#
# Usage (sourced or via hapi-fleet-seal-dispatch):
#   hapi_fleet_seal_dispatch <sealed_tag> [--dry-run]
#
set -euo pipefail

hapi_fleet_targets_path() {
    if [[ -n "${HAPI_FLEET_TARGETS:-}" ]]; then
        printf '%s\n' "$HAPI_FLEET_TARGETS"
        return 0
    fi
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    printf '%s\n' "$here/fleet-targets.yaml"
}

hapi_fleet_default_seal_manifest_url() {
    local repo channel
    repo="${HAPI_SOUP_GITHUB_REPO:-heavygee/hapi}"
    channel="${HAPI_FLEET_GH_CHANNEL_TAG:-hapi-fleet}"
    printf 'https://github.com/%s/releases/download/%s/manifest.json\n' "$repo" "$channel"
}

# List enabled targets as TSV: id<TAB>type<TAB>host<TAB>status
hapi_fleet_targets_list() {
    local path
    path="$(hapi_fleet_targets_path)"
    [[ -f "$path" ]] || { echo "ERROR: fleet targets missing: $path" >&2; return 1; }
    if ! command -v python3 >/dev/null 2>&1; then
        echo "ERROR: python3 required to parse fleet-targets.yaml" >&2
        return 1
    fi
    python3 - "$path" <<'PY'
import sys
try:
    import yaml  # type: ignore
except Exception:
    yaml = None

path = sys.argv[1]
raw = open(path, encoding="utf-8").read()
data = None
if yaml is not None:
    data = yaml.safe_load(raw)
else:
    # Minimal subset parser for our flat target maps (no nested structures beyond scalars).
    import re
    data = {"targets": []}
    cur = None
    for line in raw.splitlines():
        if re.match(r"^\s*-\s+id:\s*", line):
            if cur:
                data["targets"].append(cur)
            cur = {"enabled": True}
            cur["id"] = re.sub(r"^\s*-\s+id:\s*", "", line).strip().strip('"')
            continue
        if cur is None:
            continue
        m = re.match(r"^\s+(\w+):\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip().strip('"')
        if k == "enabled":
            cur[k] = v.lower() in ("true", "yes", "1")
        else:
            cur[k] = v
    if cur:
        data["targets"].append(cur)

for t in data.get("targets") or []:
    if t.get("enabled") is False:
        continue
    tid = t.get("id") or ""
    typ = t.get("type") or ""
    host = t.get("host") or ""
    status = t.get("status") or "active"
    print(f"{tid}\t{typ}\t{host}\t{status}")
PY
}

hapi_fleet_dispatch_estate_hub() {
    local id="$1" tag="$2" dry_run="$3"
    echo "dispatch[$id]: estate-hub — local fleet-latest should already point at $tag"
    if [[ "$dry_run" == "1" ]]; then
        echo "dispatch[$id]: dry-run — would POST /api/fleet/push-upgrade when HAPI_FLEET_PUSH_URL + machine ids set"
        return 0
    fi
    local push_url="${HAPI_FLEET_PUSH_URL:-}"
    local machine_ids="${HAPI_FLEET_PUSH_MACHINE_IDS:-}"
    local token="${HAPI_FLEET_PUSH_TOKEN:-}"
    if [[ -z "$push_url" || -z "$machine_ids" ]]; then
        echo "dispatch[$id]: skip push-upgrade (set HAPI_FLEET_PUSH_URL + HAPI_FLEET_PUSH_MACHINE_IDS to fan out)"
        return 0
    fi
    local body
    body="$(python3 -c 'import json,os; print(json.dumps({"machineIds":[x for x in os.environ["IDS"].split(",") if x]}))' \
        IDS="$machine_ids")"
    local auth=()
    if [[ -n "$token" ]]; then
        auth=(-H "Authorization: Bearer ${token}")
    fi
    curl -fsS -X POST "$push_url" \
        -H 'Content-Type: application/json' \
        "${auth[@]}" \
        -d "$body" >/dev/null
    echo "dispatch[$id]: push-upgrade OK → $push_url"
}

hapi_fleet_dispatch_standalone_layer_a() {
    local id="$1" tag="$2" dry_run="$3"
    local url
    url="$(hapi_fleet_default_seal_manifest_url)"
    echo "dispatch[$id]: standalone-layer-a — subscribers poll ${url}"
    if [[ "$dry_run" == "1" ]]; then
        echo "dispatch[$id]: dry-run — would HEAD ${url} and check tag=${tag}"
        return 0
    fi
    local remote_tag
    remote_tag="$(curl -fsSL "$url" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag",""))' 2>/dev/null || true)"
    if [[ -z "$remote_tag" ]]; then
        echo "ERROR: dispatch[$id]: cannot read channel manifest at $url" >&2
        return 1
    fi
    if [[ "$remote_tag" != "$tag" ]]; then
        echo "ERROR: dispatch[$id]: channel tag=$remote_tag != sealed $tag" >&2
        return 1
    fi
    echo "dispatch[$id]: channel OK (tag=$remote_tag) — Layer A peers will self-discover"
}

hapi_fleet_dispatch_cattle_vm_swap() {
    local id="$1" tag="$2" dry_run="$3" host="$4" status="$5"
    echo "dispatch[$id]: cattle-vm-swap host=${host:-?} status=$status sealed=$tag"
    echo "dispatch[$id]: mechanism = VM-swap (disk reattach / new root / front door) — NOT binary in-place"
    if [[ "$status" == "pending" ]]; then
        echo "dispatch[$id]: pending registration — registry row ready; no apply until host is live"
        return 0
    fi
    if [[ "$dry_run" == "1" || "${HAPI_FLEET_CATTLE_APPLY:-}" != "1" ]]; then
        echo "dispatch[$id]: PLAN ONLY (set HAPI_FLEET_CATTLE_APPLY=1 after spoken seal to run swap tooling)"
        echo "dispatch[$id]: rehearsal canon: ~/coding/janus-oos/docs/cattle-vm-swap-rehearsal.md"
        return 0
    fi
    local apply_cmd="${HAPI_FLEET_CATTLE_APPLY_CMD:-}"
    if [[ -z "$apply_cmd" ]]; then
        echo "ERROR: dispatch[$id]: HAPI_FLEET_CATTLE_APPLY=1 but HAPI_FLEET_CATTLE_APPLY_CMD unset" >&2
        return 1
    fi
    # shellcheck disable=SC2086
    env HAPI_FLEET_SEAL_TAG="$tag" HAPI_FLEET_TARGET_ID="$id" HAPI_FLEET_TARGET_HOST="$host" \
        bash -c "$apply_cmd"
    echo "dispatch[$id]: cattle apply command finished"
}

# Entry: hapi_fleet_seal_dispatch <sealed_tag> [--dry-run]
hapi_fleet_seal_dispatch() {
    local tag="" dry_run=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=1; shift ;;
            -h|--help)
                echo "Usage: hapi_fleet_seal_dispatch <sealed_tag> [--dry-run]" >&2
                return 2
                ;;
            *)
                if [[ -n "$tag" ]]; then
                    echo "ERROR: unexpected arg: $1" >&2
                    return 2
                fi
                tag="$1"
                shift
                ;;
        esac
    done
    if [[ -z "$tag" ]]; then
        echo "ERROR: sealed tag required" >&2
        return 2
    fi
    if [[ "${HAPI_SKIP_FLEET_DISPATCH:-}" == "1" ]]; then
        echo "fleet-dispatch: skipped (HAPI_SKIP_FLEET_DISPATCH=1)"
        return 0
    fi

    echo "fleet-dispatch: sealed=$tag registry=$(hapi_fleet_targets_path)"
    local id typ host status rc=0
    while IFS=$'\t' read -r id typ host status; do
        [[ -n "$id" ]] || continue
        case "$typ" in
            estate-hub)
                hapi_fleet_dispatch_estate_hub "$id" "$tag" "$dry_run" || rc=1
                ;;
            standalone-layer-a)
                hapi_fleet_dispatch_standalone_layer_a "$id" "$tag" "$dry_run" || rc=1
                ;;
            cattle-vm-swap)
                hapi_fleet_dispatch_cattle_vm_swap "$id" "$tag" "$dry_run" "$host" "$status" || rc=1
                ;;
            *)
                echo "ERROR: dispatch[$id]: unknown type '$typ'" >&2
                rc=1
                ;;
        esac
    done < <(hapi_fleet_targets_list)

    return "$rc"
}
