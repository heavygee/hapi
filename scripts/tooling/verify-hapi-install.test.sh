#!/usr/bin/env bash
# Tests for verify-hapi-install.sh installer-smoke (the source-$@ bug probe).
#
# Positive-control: the probe MUST fail on the known-bad tree and MUST pass on
# the fixed tree. Mutation-checked by swapping which tree we point at.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERIFY="$ROOT/scripts/tooling/verify-hapi-install.sh"
pass=0
fail=0
check() {
    if eval "$2"; then
        echo "ok - $1"
        pass=$((pass + 1))
    else
        echo "not ok - $1"
        fail=$((fail + 1))
    fi
}

# Fixed tree (this checkout @ b20204325 lineage): smoke must PASS.
out="$(bash "$VERIFY" --installer-smoke --profile fleet-binary 2>&1 || true)"
check "fixed tree: installer smoke passes" 'grep -q "ok - installer --profile reaches validation" <<<"$out"'
check "fixed tree: no template-not-found" '! grep -q "template not found: --profile" <<<"$out"'

# Pre-fix tree a352a7804: smoke must FAIL (positive control for the probe).
PRE_TMP="$(mktemp -d)"
trap 'rm -rf "$PRE_TMP"' EXIT
git -C "$ROOT" archive a352a7804 \
    scripts/tooling/install-hapi-systemd-units.sh \
    scripts/tooling/lib/render-hapi-systemd-unit.sh \
    scripts/tooling/lib/hapi-systemd-units.sh \
    scripts/tooling/systemd \
    2>/dev/null | tar -x -C "$PRE_TMP" || {
    # archive path may need more files; fall back to worktree files from sha
    echo "WARN: git archive incomplete — cloning sparse" >&2
}
# Point verify at the pre-fix installer by swapping REPO_ROOT via a wrapper
# that copies verify + points REPO_ROOT... simpler: run the installer's own argv
# the way verify does.
set +e
bad_out="$(bash "$PRE_TMP/scripts/tooling/install-hapi-systemd-units.sh" --profile fleet-binary 2>&1)"
set -e
check "pre-fix a352a7804: dies with template not found: --profile" \
    'grep -q "template not found: --profile" <<<"$bad_out"'

# Probe on pre-fix via verify script with REPO_ROOT override: copy verify into
# the archive tree (verify itself is new) and run --installer-smoke.
mkdir -p "$PRE_TMP/scripts/tooling"
cp "$VERIFY" "$PRE_TMP/scripts/tooling/verify-hapi-install.sh"
# verify sources lib/hapi-systemd-units — already archived
set +e
probe_out="$(bash "$PRE_TMP/scripts/tooling/verify-hapi-install.sh" --installer-smoke --profile fleet-binary 2>&1)"
probe_rc=$?
set -e
check "pre-fix: verify --installer-smoke fails" '[[ "$probe_rc" -ne 0 ]]'
check "pre-fix: verify reports not ok for installer smoke" \
    'grep -q "not ok - installer --profile reaches validation" <<<"$probe_out"'

# Standalone Tier-1 on a fresh box: empty User= from `systemctl show` is
# indistinguishable from "unit does not exist" on systemd 252, so the installer
# must demand --watchdog-user rather than guessing root. (Covered in depth by
# install-hapi-primary-hub-tier1.test.sh; this harness case keeps the stranger
# path from drifting.)
TIER1="$ROOT/scripts/tooling/install-hapi-primary-hub-tier1.sh"
empty_user_out="$(
    STUB_USER="" bash -c '
        set -euo pipefail
        WATCHDOG_USER=""; WATCHDOG_HAPI_HOME=""; WATCHDOG_PORT=""; RUNNER_UNIT=stub
        systemctl() {
            case "$*" in
                *"-p User"*) printf "%s" "$STUB_USER" ;;
                *) : ;;
            esac
        }
        getent() { :; }
        eval "$(sed -n "/^resolve_watchdog_identity()/,/^}$/p" "$0")"
        resolve_watchdog_identity
    ' "$TIER1" 2>&1 || true
)"
check "standalone Tier-1 empty User= demands --watchdog-user" \
    'grep -q "could not determine\|Pass --watchdog-user" <<<"$empty_user_out"'

echo "# pass=$pass fail=$fail"
exit "$fail"
