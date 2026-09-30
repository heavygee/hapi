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

# Only hapi-watchdog is host-identity. hapi-protect denies destructive verbs to
# the OPERATOR account agents shell out from — a different identity from the
# service account the runner runs as — so it stays static.
bash "$RENDER" "$ROOT/scripts/tooling/sudoers/hapi-watchdog.in" "$TD/hapi-watchdog" "SUDO_USER_NAME=hapi"
check "watchdog sudoers grants to the rendered user" 'grep -q "^hapi ALL=(root)" "$TD/hapi-watchdog"'
check "watchdog sudoers has no operator account" '! grep -q heavygee "$TD/hapi-watchdog"'

# The watchdog must work on a host with no clone of this repo — it is installed
# next to its one library dependency rather than pointed at a checkout.
mkdir -p "$TD/lib/lib"
install -m 0755 "$ROOT/scripts/tooling/hapi-runner-watchdog.sh" "$TD/lib/hapi-runner-watchdog.sh"
install -m 0644 "$ROOT/scripts/tooling/lib/hapi-systemd-units.sh" "$TD/lib/lib/hapi-systemd-units.sh"
out="$(HAPI_HOME="$TD/nohome" HAPI_WATCHDOG_DRY_RUN=1 bash "$TD/lib/hapi-runner-watchdog.sh" 2>&1 || true)"
check "watchdog exits cleanly with no settings.json" 'grep -q "settings.json missing" <<<"$out"'

# The early-exit above happens ~95 lines BEFORE the `source lib/...` that the
# /usr/local/lib/hapi move has to get right, so it passes even with the library
# deleted. Drive it far enough to reach that source: a stub settings.json and a
# dead API port gets us to the dry-run line, which only prints after sourcing.
mkdir -p "$TD/withhome"
printf '{"cliApiToken":"t","machineId":"m"}' >"$TD/withhome/settings.json"
# Executing far enough to hit that `source` needs a live hub — the watchdog
# exits at the probe first — so assert the structural invariant instead of
# pretending to exercise it: the path the script sources must be the path the
# installer writes to, relative to the installed script.
src_rel="$(grep -oE 'SCRIPT_DIR\}?/[a-z/.-]+hapi-systemd-units\.sh' "$ROOT/scripts/tooling/hapi-runner-watchdog.sh" | head -n1)"
src_rel="${src_rel#*SCRIPT_DIR\}}"; src_rel="${src_rel#*SCRIPT_DIR}"
check "watchdog sources a path under its own directory" '[[ "$src_rel" == /lib/hapi-systemd-units.sh ]]'
check "installer writes the lib to exactly that path" 'grep -q "WATCHDOG_LIBDIR/lib/hapi-systemd-units.sh" "$TIER1"'
check "installer writes the script to the dir that path is relative to" 'grep -q "WATCHDOG_LIBDIR/hapi-runner-watchdog.sh" "$TIER1"'
check "installed layout satisfies the source" '[[ -f "$TD/lib/lib/hapi-systemd-units.sh" && -x "$TD/lib/hapi-runner-watchdog.sh" ]]'
rm -rf "$TD"

# --- watchdog identity resolution -----------------------------------------
# The logic that decides which account the watchdog runs as, and where its
# HAPI_HOME is. Every failure here installs a unit that is silently skipped.
resolve_id() {
    STUB_USER="$1" STUB_ENV="${2:-}" STUB_PASSWD="${3:-}" \
    ARG_USER="${4:-}" ARG_HOME="${5:-}" \
    bash -c '
        set -euo pipefail
        WATCHDOG_USER="$ARG_USER"; WATCHDOG_HAPI_HOME="$ARG_HOME"
        WATCHDOG_PORT=""; RUNNER_UNIT=stub
        systemctl() {
            case "$*" in
                *"-p User"*) printf "%s" "$STUB_USER" ;;
                *"-p Environment"*) printf "%s" "$STUB_ENV" ;;
                *) : ;;
            esac
        }
        getent() { printf "%s" "$STUB_PASSWD"; }
        eval "$(sed -n "/^resolve_watchdog_identity()/,/^}$/p" "$0")"
        resolve_watchdog_identity
        echo "user=$WATCHDOG_USER home=$WATCHDOG_HAPI_HOME"
    ' "$TIER1" 2>&1
}
out="$(resolve_id "" "" "" || true)"
check "empty User= fails closed instead of defaulting to root" 'grep -q "could not determine" <<<"$out"'
check "empty User= never yields root" '! grep -q "user=root" <<<"$out"'
out="$(resolve_id "hapi" "HAPI_HOME=/var/lib/hapi" "hapi:x:1:1::/var/lib/hapi:/bin/sh" || true)"
check "User= is taken from the runner unit" 'grep -q "user=hapi" <<<"$out"'
check "HAPI_HOME is taken from the unit Environment" 'grep -q "home=/var/lib/hapi" <<<"$out"'
out="$(resolve_id "1000" "" "someuser:x:1000:1000::/home/someuser:/bin/sh" || true)"
check "numeric UID is rejected as a sudoers username" 'grep -q "not a login name" <<<"$out"'
out="$(resolve_id "weird" "" "weird:x:1:1:::/bin/sh" || true)"
check "empty passwd home fails closed rather than yielding /.hapi" 'grep -q "no usable home" <<<"$out"'

# --- orphaned-reference guard ---------------------------------------------
# hapi-protect is operator identity, not host identity, so it stays a static
# file. Renaming it to .in broke install-hapi-sudoers.sh and, through it,
# install-hapi-operator-lock.sh --with-sudo.
check "hapi-protect is still a static file" '[[ -f "$ROOT/scripts/tooling/sudoers/hapi-protect" ]]'
check "hapi-protect carries no render placeholder" '! grep -q "@SUDO_USER_NAME@" "$ROOT/scripts/tooling/sudoers/hapi-protect"'
check "install-hapi-sudoers.sh finds its source file" '! bash "$ROOT/scripts/tooling/install-hapi-sudoers.sh" --help 2>&1 | grep -q "source file missing"'


echo "# pass=$pass fail=$fail"
[[ "$fail" -eq 0 ]]
