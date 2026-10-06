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

unset HAPI_DRIVER_NO_RESTART
unset HAPI_INSIDE_JOB_RUN

job_cmd="$tmpdir/job-run.cmdline"
printf 'node\0/opt/hapi/hapi.js\0job\0run\0sid\0remat-1933\0--\0hapi-driver-rebuild' >"$job_cmd"
if ! driver_remat_argv_is_job_run "$job_cmd"; then
    echo "FAIL: expected job+run argv to match" >&2
    exit 1
fi

list_cmd="$tmpdir/job-list.cmdline"
printf 'node\0/opt/hapi/hapi.js\0job\0list' >"$list_cmd"
if driver_remat_argv_is_job_run "$list_cmd"; then
    echo "FAIL: job list must not match job run" >&2
    exit 1
fi

npm_cmd="$tmpdir/npm-run.cmdline"
printf 'npm\0run\0test' >"$npm_cmd"
if driver_remat_argv_is_job_run "$npm_cmd"; then
    echo "FAIL: npm run must not match job run" >&2
    exit 1
fi

export HAPI_INSIDE_JOB_RUN=1
if ! driver_remat_inside_job_run; then
    echo "FAIL: HAPI_INSIDE_JOB_RUN=1 should count as inside job run" >&2
    exit 1
fi
unset HAPI_INSIDE_JOB_RUN

negproc="$tmpdir/proc-neg"
mkdir -p "$negproc/9"
printf 'bash\0driver-remat-auto-restart.test.sh' >"$negproc/9/cmdline"
echo '9 (bash) S 1 9 9 0' >"$negproc/9/stat"
export HAPI_PROC_ROOT="$negproc"
export HAPI_JOB_RUN_WALK_PID=9
if driver_remat_inside_job_run; then
    echo "FAIL: isolated process tree without job run must not match" >&2
    exit 1
fi
unset HAPI_PROC_ROOT HAPI_JOB_RUN_WALK_PID

fakeproc="$tmpdir/proc"
mkdir -p "$fakeproc/100" "$fakeproc/50"
printf 'bash\0-c\0hapi-driver-rebuild' >"$fakeproc/100/cmdline"
echo '100 (bash) S 50 100 100 0' >"$fakeproc/100/stat"
printf 'node\0/opt/hapi/hapi.js\0job\0run\0sid\0k\0--\0true' >"$fakeproc/50/cmdline"
echo '50 (node) S 1 50 50 0' >"$fakeproc/50/stat"
export HAPI_PROC_ROOT="$fakeproc"
export HAPI_JOB_RUN_WALK_PID=100
if ! driver_remat_inside_job_run; then
    echo "FAIL: expected PPID walk to find hapi job run" >&2
    exit 1
fi
unset HAPI_PROC_ROOT HAPI_JOB_RUN_WALK_PID

stub_home="$tmpdir/home"
mkdir -p "$stub_home/.local/bin"
cat >"$stub_home/.local/bin/hapi-restart-hub" <<EOF
#!/bin/sh
echo RAN >"$stub_home/restart.ran"
EOF
chmod +x "$stub_home/.local/bin/hapi-restart-hub"
export HOME="$stub_home"
export HAPI_INSIDE_JOB_RUN=1
# Subshell: a leaked exec must not replace this test script.
if ! (
    driver_remat_auto_restart_hub "$tmpdir" "$base" "$hub_tip"
); then
    echo "FAIL: inside-job skip must return 0" >&2
    exit 1
fi
if [[ -f "$stub_home/restart.ran" ]]; then
    echo "FAIL: inside job run must not exec hapi-restart-hub" >&2
    exit 1
fi
unset HAPI_INSIDE_JOB_RUN
unset HOME

echo "driver-remat-auto-restart.test.sh: all passed"
