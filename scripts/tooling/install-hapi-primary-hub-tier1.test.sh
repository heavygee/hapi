#!/usr/bin/env bash
# Tests for the Tier-1 runner-stop resolution + its verifier assertion.
#
# Both are text parsers whose failure mode is SILENT: a stop command that
# cannot execute is hidden by systemd's `-` prefix, and the drop-in still looks
# correctly installed. That is how the soup-only ExecStartPre survived on every
# fleet host. So the cases that must FAIL matter more than the ones that pass.
#
# shellcheck disable=SC2016,SC2034
#   SC2016/SC2034: assertions are single-quoted on purpose — `check` evaluates
#   them after `$out` is set, so the variables are used, just not visibly here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIER1="$ROOT/scripts/tooling/install-hapi-primary-hub-tier1.sh"
VERIFY="$ROOT/scripts/tooling/verify-hapi-systemd-units.sh"

pass=0; fail=0
check() { if eval "$2"; then echo "ok - $1"; pass=$((pass+1)); else echo "not ok - $1"; fail=$((fail+1)); fi; }

# --- resolver ---------------------------------------------------------------
# Runs resolve_runner_stop_cmd() with `systemctl` stubbed, so no real unit or
# root is needed. $1 = stubbed `systemctl show ExecStart` output.
resolve() {
    local show="$1" stop="${2:-}" bin="${3:-}"
    RUNNER_STOP_CMD="$stop" RUNNER_BIN="$bin" RUNNER_UNIT=stub \
    STUB_SHOW="$show" bash -c '
        set -euo pipefail
        systemctl() { printf "%s" "$STUB_SHOW"; }
        eval "$(sed -n "/^resolve_runner_stop_cmd()/,/^}$/p" "$0")"
        resolve_runner_stop_cmd
    ' "$TIER1" 2>&1
}
SINGLE_EXE='{ path=/bin/true ; argv[]=/bin/true runner start-sync --workspace-root /w ; ignore_errors=no }'
BUN_STYLE='{ path=/bin/true ; argv[]=/bin/true run /c/src/index.ts runner start-sync ; ignore_errors=no }'
SHELL_WRAP='{ path=/bin/bash ; argv[]=/bin/bash -lc exec /bin/true run src/index.ts runner start-sync ; ignore_errors=no }'

out="$(resolve "$SINGLE_EXE")"
check "single-exe unit auto-detects its own binary" '[[ "$out" == "-/bin/true runner stop" ]]'

# The fail-open case: `bun run <script> runner start-sync` is not the single-exe
# shape. Reusing argv[0] would emit `bun runner stop`, which bun reads as a
# script name, exits non-zero, and the `-` swallows it — the original bug.
out="$(resolve "$BUN_STYLE" || true)"
check "interpreter-style unit refuses to guess" 'grep -q "cannot determine" <<<"$out"'
out="$(resolve "$SHELL_WRAP" || true)"
check "shell-wrapped unit refuses to guess" 'grep -q "cannot determine" <<<"$out"'
out="$(resolve "" || true)"
check "unknown unit refuses to guess" 'grep -q "cannot determine" <<<"$out"'

out="$(resolve "$SINGLE_EXE" "/opt/hapi/hapi runner stop")"
check "--runner-stop-cmd gains the ignore-failure prefix" '[[ "$out" == "-/opt/hapi/hapi runner stop" ]]'
out="$(resolve "$SINGLE_EXE" "-/opt/hapi/hapi runner stop")"
check "--runner-stop-cmd keeps an existing prefix" '[[ "$out" == "-/opt/hapi/hapi runner stop" ]]'
out="$(resolve "$SINGLE_EXE" "" /bin/true)"
check "--runner-bin wins over auto-detect" '[[ "$out" == "-/bin/true runner stop" ]]'
out="$(resolve "$SINGLE_EXE" "" /tmp || true)"
check "--runner-bin rejects a directory" 'grep -q "not an executable file" <<<"$out"'
out="$(resolve "$SINGLE_EXE" "" /nope/hapi || true)"
check "--runner-bin rejects a missing path" 'grep -q "not an executable file" <<<"$out"'

# --- verifier assertion -----------------------------------------------------
assert_pre() {
    TEST_PRE="$1" TEST_RESTART="$2" bash -c '
        set -euo pipefail
        FAIL=0
        ok(){ printf "OK: %s\n" "$1"; }
        fail(){ printf "FAIL: %s\n" "$1"; FAIL=1; }
        RUNNER_UNIT=stub
        show_prop(){ if [[ "$2" == ExecStartPre ]]; then printf "%s" "$TEST_PRE"; else printf "%s" "$TEST_RESTART"; fi; }
        eval "$(sed -n "/^exec_start_pre=/,/^fi$/p" "$0")"
        exit $FAIL
    ' "$VERIFY" 2>&1
}
STOP_OK='{ path=/bin/true ; argv[]=/bin/true runner stop ; ignore_errors=yes }'
STOP_MISSING='{ path=/bin/bash ; argv[]=/bin/bash -lc /nonexistent/bun run --cwd /nope /nope/src/index.ts runner stop ; ignore_errors=yes }'
STOP_CD='{ path=/bin/bash ; argv[]=/bin/bash -lc cd /tmp && /nonexistent/bun run src/index.ts runner stop ; ignore_errors=yes }'
STOP_WRAPPED_OK='{ path=/bin/bash ; argv[]=/bin/bash -lc /bin/true run src/index.ts runner stop ; ignore_errors=yes }'
TWO_ENTRIES='{ path=/bin/true ; argv[]=/bin/true ; ignore_errors=no }
{ path=/bin/bash ; argv[]=/bin/bash -lc /bin/true run x runner stop ; ignore_errors=yes }'

check "direct stop with a real binary passes" 'assert_pre "$STOP_OK" always >/dev/null'
check "wrapped stop with a real interpreter passes" 'assert_pre "$STOP_WRAPPED_OK" always >/dev/null'
check "stop as 2nd of 2 entries is the one checked" 'assert_pre "$TWO_ENTRIES" always >/dev/null'
check "no stop is fine when Restart=on-failure" 'assert_pre "" on-failure >/dev/null'

# Directories satisfy -x, so a `cd /dir && <missing interp>` form must not pass.
check "soup stop on a fleet host fails" '! assert_pre "$STOP_MISSING" always >/dev/null'
check "cd-prefixed stop with missing interpreter fails" '! assert_pre "$STOP_CD" always >/dev/null'
check "no stop with Restart=always fails" '! assert_pre "" always >/dev/null'

# --- installer argument handling ------------------------------------------
# `source lib/render-hapi-systemd-unit.sh` used to run that file's top-level CLI
# against the CALLER's unconsumed "$@", so every invocation died on
# `ERROR: template not found: --profile` before parsing anything. The lib now
# keeps its work in a function and guards the CLI behind BASH_SOURCE == $0.
UNITS="$ROOT/scripts/tooling/install-hapi-systemd-units.sh"
out="$(bash "$UNITS" --profile bogus 2>&1 || true)"
check "installer parses args before sourcing the render lib" '! grep -q "template not found" <<<"$out"'
check "installer reaches profile validation" 'grep -q "unknown profile: bogus" <<<"$out"'
out="$(bash "$UNITS" 2>&1 || true)"
check "installer reports a missing --profile" 'grep -q "profile required" <<<"$out"'

# The lib must still work as a standalone CLI.
tmpl="$(mktemp)"; outf="$(mktemp)"; printf 'x=@K@\n' >"$tmpl"
bash "$ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh" "$tmpl" "$outf" "K=v" 2>/dev/null
check "render lib still runs as a CLI" '[[ "$(cat "$outf")" == "x=v" ]]'
rm -f "$tmpl" "$outf"

# --- watchdog / sudoers portability ---------------------------------------
# These were hardcoded to the soup operator's account. On any other host the
# watchdog's ConditionPathExists could not be satisfied, so systemd skipped the
# service on every fire while the timer still reported enabled, and the sudoers
# rules granted to a user that did not exist — valid syntax, applying to nobody.
RENDER="$ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh"
TD="$(mktemp -d)"
bash "$RENDER" "$ROOT/scripts/tooling/systemd/hapi-runner-watchdog.service.in" "$TD/wd.service" \
    "WATCHDOG_USER=hapi" "HAPI_HOME=/var/lib/hapi" "HAPI_PORT=3006" \
    "WATCHDOG_SCRIPT=/usr/local/lib/hapi/hapi-runner-watchdog.sh"
check "watchdog unit renders without operator paths" '! grep -q heavygee "$TD/wd.service"'
check "watchdog condition follows HAPI_HOME" 'grep -q "^ConditionPathExists=/var/lib/hapi/settings.json$" "$TD/wd.service"'
check "watchdog runs as the runner's own user" 'grep -q "^User=hapi$" "$TD/wd.service"'
check "watchdog ExecStart is an installed path" 'grep -q "^ExecStart=/usr/local/lib/hapi/" "$TD/wd.service"'

for f in hapi-protect hapi-watchdog; do
    bash "$RENDER" "$ROOT/scripts/tooling/sudoers/$f.in" "$TD/$f" "SUDO_USER_NAME=hapi"
    check "sudoers $f grants to the rendered user" 'grep -q "^hapi ALL=(root)" "$TD/$f"'
    check "sudoers $f has no operator account" '! grep -q heavygee "$TD/$f"'
done

# The watchdog must work on a host with no clone of this repo — it is installed
# next to its one library dependency rather than pointed at a checkout.
mkdir -p "$TD/lib/lib"
install -m 0755 "$ROOT/scripts/tooling/hapi-runner-watchdog.sh" "$TD/lib/hapi-runner-watchdog.sh"
install -m 0644 "$ROOT/scripts/tooling/lib/hapi-systemd-units.sh" "$TD/lib/lib/hapi-systemd-units.sh"
out="$(HAPI_HOME="$TD/nohome" HAPI_WATCHDOG_DRY_RUN=1 bash "$TD/lib/hapi-runner-watchdog.sh" 2>&1 || true)"
check "watchdog runs from its installed layout" 'grep -q "settings.json missing" <<<"$out"'
rm -rf "$TD"

echo "# pass=$pass fail=$fail"
[[ "$fail" -eq 0 ]]
