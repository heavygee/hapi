#!/usr/bin/env bash
# Unit tests for driver-remat-tip-forward.sh (no network).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB="$ROOT/scripts/tooling/lib/driver-remat-tip-forward.sh"
# shellcheck source=driver-remat-tip-forward.sh
source "$LIB"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email test@test
git -C "$tmpdir" config user.name test
echo base >"$tmpdir/f"
git -C "$tmpdir" add f
git -C "$tmpdir" commit -q -m base
git -C "$tmpdir" branch -M main
base_sha="$(git -C "$tmpdir" rev-parse HEAD)"

git -C "$tmpdir" checkout -q -b upstream-main
echo up >"$tmpdir/f"
git -C "$tmpdir" commit -q -am up
up_sha="$(git -C "$tmpdir" rev-parse HEAD)"

git -C "$tmpdir" checkout -q main
echo fork >"$tmpdir/docs"
git -C "$tmpdir" add docs
git -C "$tmpdir" commit -q -m utensil
fork_sha="$(git -C "$tmpdir" rev-parse HEAD)"

git -C "$tmpdir" update-ref refs/remotes/upstream/main "$up_sha"
git -C "$tmpdir" update-ref refs/remotes/origin/main "$fork_sha"

# RED→GREEN: origin/main base must win over upstream/main when both exist.
got="$(driver_remat_tip_forward_merge_ref origin/main "$tmpdir")"
if [[ "$got" != "origin/main" ]]; then
    echo "FAIL: expected origin/main, got '$got'" >&2
    exit 1
fi

got="$(driver_remat_tip_forward_merge_ref main "$tmpdir")"
if [[ "$got" != "main" ]]; then
    echo "FAIL: expected main, got '$got'" >&2
    exit 1
fi

got="$(driver_remat_tip_forward_merge_ref upstream/main "$tmpdir")"
if [[ "$got" != "upstream/main" ]]; then
    echo "FAIL: expected upstream/main for legacy base, got '$got'" >&2
    exit 1
fi

# Missing base falls back to upstream/main when present.
got="$(driver_remat_tip_forward_merge_ref 'refs/heads/does-not-exist' "$tmpdir")"
if [[ "$got" != "upstream/main" ]]; then
    echo "FAIL: expected upstream/main fallback, got '$got'" >&2
    exit 1
fi

echo "driver-remat-tip-forward.test.sh: all passed"
