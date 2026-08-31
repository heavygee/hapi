#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAP="$ROOT/scripts/tooling/gh-wrapper.sh"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/gh-wrap-test.XXXXXX")"
FAKE_GH="$WORKDIR/fake-gh"
LOG="$WORKDIR/log.txt"
trap "rm -rf \"$WORKDIR\"" EXIT
printf "%s\n" "#!/usr/bin/env bash" "echo fake-gh:\$* >>\"\${GH_WRAP_LOG:?}\"" "printf OK:%s\\\\n \"\$*\"" >"$FAKE_GH"
chmod +x "$FAKE_GH"
pass=0; fail=0
check() { if eval "$2"; then echo "ok - $1"; pass=$((pass+1)); else echo "not ok - $1"; fail=$((fail+1)); fi; }
has() { printf "%s" "$1" | grep -q "$2"; }
mkdir -p "$WORKDIR/other"; git -C "$WORKDIR/other" init -q
git -C "$WORKDIR/other" config user.email t@t; git -C "$WORKDIR/other" config user.name t
: >"$LOG"; rc=0
out="$(cd "$WORKDIR/other" && HAPI_REAL_GH="$FAKE_GH" GH_WRAP_LOG="$LOG" env -u HAPI_PR_CREATE_ACK -u HAPI_AGENT_CONTEXT -u CURSOR_AGENT bash "$WRAP" pr create --repo heavygee/nuzzle --title x --body y 2>&1)" || rc=$?
check "non-hapi exit 0" "[[ $rc -eq 0 ]]"
check "non-hapi no checklist" "! has \"\$out\" PRE-PR"
check "non-hapi called gh" "grep -q fake-gh \"$LOG\""
mkdir -p "$WORKDIR/hapi/scripts/tooling/lib"
printf "%s\n" "pr_target_resolve_repo() { echo heavygee/hapi; }" "pr_target_upstream_block_reason() { return 1; }" >"$WORKDIR/hapi/scripts/tooling/lib/pr-target-guard.sh"
git -C "$WORKDIR/hapi" init -q
git -C "$WORKDIR/hapi" config user.email t@t; git -C "$WORKDIR/hapi" config user.name t
: >"$LOG"; set +e
out="$(cd "$WORKDIR/hapi" && HAPI_REAL_GH="$FAKE_GH" GH_WRAP_LOG="$LOG" env HAPI_AGENT_CONTEXT=1 HAPI_PR_CREATE_ACK= bash "$WRAP" pr create --repo heavygee/hapi --title x --body y 2>&1)"; rc=$?; set -e
check "agent no-ack refuses" "[[ $rc -eq 2 ]]"
check "agent no-ack msg" "has \"\$out\" HAPI_PR_CREATE_ACK"
check "agent no-ack no gh" "! grep -q fake-gh \"$LOG\""
: >"$LOG"; rc=0
out="$(cd "$WORKDIR/hapi" && HAPI_REAL_GH="$FAKE_GH" GH_WRAP_LOG="$LOG" env HAPI_AGENT_CONTEXT=1 HAPI_PR_CREATE_ACK=1 bash "$WRAP" pr create --repo heavygee/hapi --title x --body y 2>&1)" || rc=$?
check "agent ack exit 0" "[[ $rc -eq 0 ]]"
check "agent ack checklist" "has \"\$out\" PRE-PR"
check "agent ack called gh" "grep -q fake-gh \"$LOG\""
echo pass=$pass fail=$fail
[[ $fail -eq 0 ]]
