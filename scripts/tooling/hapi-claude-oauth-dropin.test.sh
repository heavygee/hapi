#!/usr/bin/env bash
# Unit test for lib/hapi-claude-oauth-dropin.sh — path defaults + drop-in write.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/hapi-claude-oauth-dropin.sh
source "$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check() {
    local name="$1" cond="$2"
    if eval "$cond"; then
        echo "OK: $name"
    else
        echo "FAIL: $name" >&2
        exit 1
    fi
}

# Canonical path when nothing exists yet.
got="$(hapi_claude_oauth_default_token_file "$TMP/hapi-home")"
check "canonical path" "[[ \"$got\" == \"$TMP/hapi-home/claude-setup-token.env\" ]]"

# Legacy antevorta hotfix path wins when present and canonical is absent.
mkdir -p "$TMP/legacy/.hapi"
touch "$TMP/legacy/.hapi/claude-setup-token.env"
got="$(hapi_claude_oauth_default_token_file "$TMP/legacy")"
check "legacy path preferred" "[[ \"$got\" == \"$TMP/legacy/.hapi/claude-setup-token.env\" ]]"

# User-scope drop-in write (no systemctl root needed — daemon-reload may fail
# in CI/sandbox without a user bus; tolerate that by stubbing systemctl).
export XDG_CONFIG_HOME="$TMP/xdg"
mkdir -p "$XDG_CONFIG_HOME"
PATH_STUB="$TMP/bin"
mkdir -p "$PATH_STUB"
cat >"$PATH_STUB/systemctl" <<'EOF'
#!/usr/bin/env bash
# stub — drop-in install only needs daemon-reload to be non-fatal
exit 0
EOF
chmod +x "$PATH_STUB/systemctl"
PATH="$PATH_STUB:$PATH"

token="$TMP/pet/claude-setup-token.env"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >/tmp/hapi-claude-oauth-dropin-test.out

dropin="$XDG_CONFIG_HOME/systemd/user/hapi-runner.service.d/42-claude-oauth-token.conf"
check "drop-in created" "[[ -f \"$dropin\" ]]"
check "drop-in points at token file" "grep -q \"EnvironmentFile=-$token\" \"$dropin\""
check "instructions printed when token missing" "grep -q 'Not logged in' /tmp/hapi-claude-oauth-dropin-test.out"
check "instructions name concrete user unit" "grep -q 'systemctl --user restart hapi-runner.service' /tmp/hapi-claude-oauth-dropin-test.out"
check "instructions have no placeholder unit" "! grep -q '<runner-unit>' /tmp/hapi-claude-oauth-dropin-test.out"

# With a real token line, no setup banner.
printf 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test\n' >"$token"
chmod 600 "$token"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >/tmp/hapi-claude-oauth-dropin-test2.out
check "token present message" "grep -q 'token file present' /tmp/hapi-claude-oauth-dropin-test2.out"
check "no setup banner when token present" "! grep -q 'NOT configured yet' /tmp/hapi-claude-oauth-dropin-test2.out"
check "token present prompts runner restart" \
    "grep -q 'systemctl --user restart hapi-runner.service' /tmp/hapi-claude-oauth-dropin-test2.out"

# Symlink token file must be refused before chmod/chown (Codex P1 / antevorta threat).
symlink_target="$TMP/symlink-target"
symlink_token="$TMP/symlink-token.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-symlink\n' >"$symlink_target"
ln -s "$symlink_target" "$symlink_token"
set +e
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$symlink_token" >/tmp/hapi-claude-oauth-dropin-symlink.out 2>/tmp/hapi-claude-oauth-dropin-symlink.err
symlink_rc=$?
set -e
check "symlink token file refused" "[[ $symlink_rc -ne 0 ]]"
check "symlink refusal mentions symlink" "grep -qi symlink /tmp/hapi-claude-oauth-dropin-symlink.err"

# Direct assert helper too.
set +e
hapi_claude_oauth_assert_safe_token_file "$symlink_token" 2>/dev/null
assert_rc=$?
set -e
check "assert_safe rejects symlink" "[[ $assert_rc -ne 0 ]]"
regular="$TMP/regular.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=x\n' >"$regular"
check "assert_safe accepts regular file" "hapi_claude_oauth_assert_safe_token_file \"$regular\""

# Secure chmod/chown must refuse symlink via O_NOFOLLOW (not check-then-use).
set +e
hapi_claude_oauth_secure_chmod_chown "$symlink_token" 2>/tmp/hapi-claude-oauth-secure-symlink.err
secure_rc=$?
set -e
check "secure_chmod rejects symlink" "[[ $secure_rc -ne 0 ]]"
chmod 0644 "$regular"
hapi_claude_oauth_secure_chmod_chown "$regular"
mode="$(stat -c '%a' "$regular")"
check "secure_chmod sets 600" "[[ \"$mode\" == \"600\" ]]"

# Shell fallback must work for user-scope (no --owner) when python3 is forced off.
chmod 0644 "$regular"
HAPI_CLAUDE_OAUTH_FORCE_SHELL=1 hapi_claude_oauth_secure_chmod_chown "$regular"
mode="$(stat -c '%a' "$regular")"
check "secure_chmod shell fallback sets 600" "[[ \"$mode\" == \"600\" ]]"
set +e
HAPI_CLAUDE_OAUTH_FORCE_SHELL=1 hapi_claude_oauth_secure_chmod_chown "$symlink_token" 2>/dev/null
shell_symlink_rc=$?
set -e
check "secure_chmod shell fallback rejects symlink" "[[ $shell_symlink_rc -ne 0 ]]"

# System-profile (owner set) must fail closed without python — never path chown as root.
set +e
HAPI_CLAUDE_OAUTH_FORCE_SHELL=1 hapi_claude_oauth_secure_chmod_chown "$regular" "hapi:hapi" \
    >/tmp/hapi-claude-oauth-force-shell-owner.out 2>/tmp/hapi-claude-oauth-force-shell-owner.err
owner_shell_rc=$?
set -e
check "secure_chmod system shell path fails closed" "[[ $owner_shell_rc -ne 0 ]]"
check "secure_chmod system shell path mentions python3" \
    "grep -qi python3 /tmp/hapi-claude-oauth-force-shell-owner.err"

# System-scope instructions use systemctl restart (not --user).
hapi_print_claude_oauth_setup_instructions "$token" "hapi-runner.service" "system" \
    >/tmp/hapi-claude-oauth-dropin-system-instr.out
check "system instructions use systemctl restart" \
    "grep -q 'systemctl restart hapi-runner.service' /tmp/hapi-claude-oauth-dropin-system-instr.out"

echo "ALL OK"
