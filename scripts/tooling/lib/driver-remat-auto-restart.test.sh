#!/usr/bin/env bash
# Unit tests for driver-remat-auto-restart.sh (no network, no systemd).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB="$ROOT/scripts/tooling/lib/driver-remat-auto-restart.sh"
# shellcheck source=driver-remat-auto-restart.sh
source "$LIB"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email test@test
git -C "$tmpdir" config user.name test

mkdir -p "$tmpdir/hub" "$tmpdir/cli" "$tmpdir/web"
echo v1 >"$tmpdir/hub/a.ts"
echo v1 >"$tmpdir/web/index.ts"
git -C "$tmpdir" add hub web
git -C "$tmpdir" commit -q -m base
base="$(git -C "$tmpdir" rev-parse HEAD)"

echo v2 >"$tmpdir/hub/a.ts"
git -C "$tmpdir" add hub
git -C "$tmpdir" commit -q -m "hub-change"
hub_tip="$(git -C "$tmpdir" rev-parse HEAD)"

echo v2 >"$tmpdir/web/index.ts"
git -C "$tmpdir" add web
git -C "$tmpdir" commit -q -m "web-only"
web_tip="$(git -C "$tmpdir" rev-parse HEAD)"

if ! driver_remat_touched_hub_cli_shared "$tmpdir" "$base" "$hub_tip"; then
    echo "FAIL: expected hub change detected" >&2
    exit 1
fi

if driver_remat_touched_hub_cli_shared "$tmpdir" "$hub_tip" "$web_tip"; then
    echo "FAIL: web-only change should not trigger restart" >&2
    exit 1
fi

if driver_remat_touched_hub_cli_shared "$tmpdir" "$base" "$base"; then
    echo "FAIL: identical SHAs should not trigger" >&2
    exit 1
fi

mkdir -p "$tmpdir/hub/src/store"
cat >"$tmpdir/hub/src/store/index.ts" <<'EOF'
const SCHEMA_VERSION: number = 28
EOF
git -C "$tmpdir" add hub/src/store/index.ts
git -C "$tmpdir" commit -q -m "schema-28"
schema28="$(git -C "$tmpdir" rev-parse HEAD)"

echo 'const SCHEMA_VERSION: number = 29' >"$tmpdir/hub/src/store/index.ts"
git -C "$tmpdir" add hub/src/store/index.ts
git -C "$tmpdir" commit -q -m "schema-29"
schema29="$(git -C "$tmpdir" rev-parse HEAD)"

if ! driver_remat_hub_schema_bumped "$tmpdir" "$schema28" "$schema29"; then
    echo "FAIL: expected schema bump detected" >&2
    exit 1
fi

if driver_remat_needs_hub_restart "$tmpdir" "$schema29" "$schema29"; then
    echo "FAIL: identical SHAs without live DB should not need restart" >&2
    exit 1
fi

export HAPI_DRIVER_NO_RESTART=1
if driver_remat_auto_restart_hub "$tmpdir" "$base" "$hub_tip"; then
    echo "OK: opt-out skips restart"
else
    echo "FAIL: opt-out should return 0" >&2
    exit 1
fi

echo "driver-remat-auto-restart.test.sh: all passed"
