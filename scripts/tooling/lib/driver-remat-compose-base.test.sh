#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=driver-remat-compose-base.sh
source "$ROOT/scripts/tooling/lib/driver-remat-compose-base.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email t@t
git -C "$tmpdir" config user.name t
echo a >"$tmpdir/f" && git -C "$tmpdir" add f && git -C "$tmpdir" commit -q -m a
git -C "$tmpdir" branch -M main
old="$(git -C "$tmpdir" rev-parse HEAD)"
echo b >"$tmpdir/f" && git -C "$tmpdir" commit -q -am b
new="$(git -C "$tmpdir" rev-parse HEAD)"
git -C "$tmpdir" update-ref refs/remotes/origin/main "$old"

# Stale: main ahead of origin/main → refuse
if driver_remat_validate_compose_base "$tmpdir" origin/main >/dev/null 2>&1; then
    echo "FAIL: expected refuse when main ahead of origin/main" >&2
    exit 1
fi

# Fresh: origin/main == main → ok
git -C "$tmpdir" update-ref refs/remotes/origin/main "$new"
out="$(driver_remat_validate_compose_base "$tmpdir" origin/main)"
[[ "$out" == Base:\ origin/main\ @* ]] || { echo "FAIL: got '$out'" >&2; exit 1; }

# Unresolved origin base → refuse
git -C "$tmpdir" update-ref -d refs/remotes/origin/main
if driver_remat_validate_compose_base "$tmpdir" origin/main >/dev/null 2>&1; then
    echo "FAIL: expected refuse for missing origin/main" >&2
    exit 1
fi

echo "driver-remat-compose-base.test.sh: all passed"
