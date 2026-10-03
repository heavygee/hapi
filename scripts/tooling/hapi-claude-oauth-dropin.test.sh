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

# User/pet canonical path when nothing exists yet.
got="$(hapi_claude_oauth_default_token_file "$TMP/hapi-home")"
check "canonical path" "[[ \"$got\" == \"$TMP/hapi-home/claude-setup-token.env\" ]]"

# System fleet path is root-controlled under /etc/hapi (not service home).
got="$(hapi_claude_oauth_system_token_file)"
check "system token path" "[[ \"$got\" == \"/etc/hapi/claude-setup-token.env\" ]]"

# Legacy antevorta hotfix path must NOT win - migrate is operational, not dual-path.
mkdir -p "$TMP/legacy/.hapi"
touch "$TMP/legacy/.hapi/claude-setup-token.env"
got="$(hapi_claude_oauth_default_token_file "$TMP/legacy")"
check "canonical even when legacy exists" "[[ \"$got\" == \"$TMP/legacy/claude-setup-token.env\" ]]"

# Fresh token parent is created 0700; pre-existing parents keep their mode.
fresh_parent="$TMP/fresh-home"
fresh_token="$fresh_parent/claude-setup-token.env"
export XDG_CONFIG_HOME="$TMP/xdg-fresh"
mkdir -p "$XDG_CONFIG_HOME"
PATH_STUB="$TMP/bin"
mkdir -p "$PATH_STUB"
cat >"$PATH_STUB/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$PATH_STUB/systemctl"
PATH="$PATH_STUB:$PATH"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$fresh_token" >$TMP/hapi-claude-oauth-fresh-parent.out 2>$TMP/hapi-claude-oauth-fresh-parent.err
fresh_mode="$(stat -c '%a' "$fresh_parent")"
check "fresh token parent is 0700" "[[ \"$fresh_mode\" == \"700\" ]]"

existing_parent="$TMP/existing-home"
mkdir -m 0755 -p "$existing_parent"
existing_token="$existing_parent/claude-setup-token.env"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$existing_token" >$TMP/hapi-claude-oauth-existing-parent.out 2>$TMP/hapi-claude-oauth-existing-parent.err
existing_mode="$(stat -c '%a' "$existing_parent")"
check "existing token parent mode preserved" "[[ \"$existing_mode\" == \"755\" ]]"

# Legacy-only file is auto-copied to canonical (never cp -a); drop-in stays canonical.
legacy_home="$TMP/migrate-home"
mkdir -p "$legacy_home/.hapi"
printf 'CLAUDE_CODE_OAUTH_TOKEN=legacy\n' >"$legacy_home/.hapi/claude-setup-token.env"
chmod 600 "$legacy_home/.hapi/claude-setup-token.env"
canon_token="$legacy_home/claude-setup-token.env"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$canon_token" >$TMP/hapi-claude-oauth-migrate.out 2>$TMP/hapi-claude-oauth-migrate.err
check "legacy auto-migrated to canonical" "grep -q 'Migrated Claude OAuth token' $TMP/hapi-claude-oauth-migrate.out"
check "canonical has migrated value" "grep -q 'CLAUDE_CODE_OAUTH_TOKEN=legacy' \"$canon_token\""
check "canonical is not a symlink" "[[ ! -L \"$canon_token\" ]]"
check "legacy source retired after migrate" "[[ ! -e \"$legacy_home/.hapi/claude-setup-token.env\" ]]"
check "legacy archive exists after migrate" \
    "ls \"$legacy_home/.hapi/claude-setup-token.env.migrated.\"* >/dev/null 2>&1"
check "retire message logged" "grep -q 'Retired legacy Claude OAuth token' $TMP/hapi-claude-oauth-migrate.out"
dropin_migrate="$XDG_CONFIG_HOME/systemd/user/hapi-runner.service.d/42-claude-oauth-token.conf"
check "drop-in stays on canonical despite legacy" \
    "grep -q \"EnvironmentFile=-$canon_token\" \"$dropin_migrate\""

# Empty canonical must NOT re-import a retired legacy archive on reinstall.
: >"$canon_token"
chmod 600 "$canon_token"
set +e
hapi_install_claude_oauth_dropin \
    --scope user --runner-unit hapi-runner.service \
    --token-file "$canon_token" >$TMP/hapi-claude-oauth-remigrate.out 2>$TMP/hapi-claude-oauth-remigrate.err
remigrate_rc=$?
set -e
check "retired remigrate invokes real installer" "[[ $remigrate_rc -eq 0 || $remigrate_rc -ne 127 ]]"
check "retired remigrate did not command-not-found" \
    "! grep -qi 'command not found' $TMP/hapi-claude-oauth-remigrate.err"
check "retired archive not re-copied into empty canon" \
    "! grep -q 'CLAUDE_CODE_OAUTH_TOKEN=legacy' \"$canon_token\""
check "retired archive file still present" \
    "ls \"$legacy_home/.hapi/claude-setup-token.env.migrated.\"* >/dev/null 2>&1"

# Symlink legacy must be refused (not copied into canonical).
symlink_legacy_home="$TMP/symlink-migrate"
mkdir -p "$symlink_legacy_home/.hapi"
printf 'CLAUDE_CODE_OAUTH_TOKEN=evil\n' >"$symlink_legacy_home/.hapi/real.env"
ln -s "$symlink_legacy_home/.hapi/real.env" "$symlink_legacy_home/.hapi/claude-setup-token.env"
symlink_canon="$symlink_legacy_home/claude-setup-token.env"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$symlink_canon" >$TMP/hapi-claude-oauth-symlink-mig.out 2>$TMP/hapi-claude-oauth-symlink-mig.err || true
check "symlink legacy refused" "grep -qi 'refusing.*symlink' $TMP/hapi-claude-oauth-symlink-mig.err"
check "symlink legacy leaves canonical absent" "[[ ! -e \"$symlink_canon\" ]]"
check "migrate pending after symlink refuse" "[[ \"${HAPI_CLAUDE_OAUTH_MIGRATE_PENDING:-0}\" -eq 1 ]]"

# User-scope drop-in write (no systemctl root needed — daemon-reload may fail
# in CI/sandbox without a user bus; tolerate that by stubbing systemctl).
export XDG_CONFIG_HOME="$TMP/xdg"
mkdir -p "$XDG_CONFIG_HOME"
PATH="$PATH_STUB:$PATH"

token="$TMP/pet/claude-setup-token.env"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >$TMP/hapi-claude-oauth-dropin-test.out

dropin="$XDG_CONFIG_HOME/systemd/user/hapi-runner.service.d/42-claude-oauth-token.conf"
check "drop-in created" "[[ -f \"$dropin\" ]]"
check "drop-in points at token file" "grep -q \"EnvironmentFile=-$token\" \"$dropin\""
check "instructions printed when token missing" "grep -q 'Not logged in' $TMP/hapi-claude-oauth-dropin-test.out"
check "instructions name concrete user unit" "grep -q 'systemctl --user restart hapi-runner.service' $TMP/hapi-claude-oauth-dropin-test.out"
check "instructions have no placeholder unit" "! grep -q '<runner-unit>' $TMP/hapi-claude-oauth-dropin-test.out"

# With a real token line, no setup banner.
printf 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test\n' >"$token"
chmod 600 "$token"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >$TMP/hapi-claude-oauth-dropin-test2.out
check "token present message" "grep -q 'token file present' $TMP/hapi-claude-oauth-dropin-test2.out"
check "no setup banner when token present" "! grep -q 'NOT configured yet' $TMP/hapi-claude-oauth-dropin-test2.out"
check "token present prompts runner restart" \
    "grep -q 'systemctl --user restart hapi-runner.service' $TMP/hapi-claude-oauth-dropin-test2.out"

# Whitespace-only / CRLF-empty assignment is unconfigured (not "present").
printf 'CLAUDE_CODE_OAUTH_TOKEN=\r\n' >"$token"
chmod 600 "$token"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >$TMP/hapi-claude-oauth-dropin-ws.out 2>$TMP/hapi-claude-oauth-dropin-ws.err
check "CRLF-empty not reported present" \
    "! grep -q 'token file present' $TMP/hapi-claude-oauth-dropin-ws.out"
check "CRLF-empty prints setup instructions" \
    "grep -q 'NOT configured yet' $TMP/hapi-claude-oauth-dropin-ws.out"

# Symlink token file must be refused before chmod/chown (Codex P1 / antevorta threat).
symlink_target="$TMP/symlink-target"
symlink_token="$TMP/symlink-token.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-symlink\n' >"$symlink_target"
ln -s "$symlink_target" "$symlink_token"
set +e
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$symlink_token" >$TMP/hapi-claude-oauth-dropin-symlink.out 2>$TMP/hapi-claude-oauth-dropin-symlink.err
symlink_rc=$?
set -e
check "symlink token file refused" "[[ $symlink_rc -ne 0 ]]"
check "symlink refusal mentions symlink" "grep -qi symlink $TMP/hapi-claude-oauth-dropin-symlink.err"

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
hapi_claude_oauth_secure_chmod_chown "$symlink_token" 2>$TMP/hapi-claude-oauth-secure-symlink.err
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
    >$TMP/hapi-claude-oauth-force-shell-owner.out 2>$TMP/hapi-claude-oauth-force-shell-owner.err
owner_shell_rc=$?
set -e
check "secure_chmod system shell path fails closed" "[[ $owner_shell_rc -ne 0 ]]"
check "secure_chmod system shell path mentions python3" \
    "grep -qi python3 $TMP/hapi-claude-oauth-force-shell-owner.err"

# System-scope instructions use systemctl restart (not --user).
hapi_print_claude_oauth_setup_instructions "/etc/hapi/claude-setup-token.env" "hapi-runner.service" "system" \
    >$TMP/hapi-claude-oauth-dropin-system-instr.out
check "system instructions use sudo systemctl restart" \
    "grep -q 'sudo systemctl restart hapi-runner.service' $TMP/hapi-claude-oauth-dropin-system-instr.out"
check "system instructions use privileged install -m 0600" \
    "grep -q 'sudo install -m 0600 /dev/stdin' $TMP/hapi-claude-oauth-dropin-system-instr.out"
check "system instructions do not use tee+chmod race" \
    "! grep -q 'sudo tee' $TMP/hapi-claude-oauth-dropin-system-instr.out"

# Last-assignment empty final must not claim token present.
printf 'CLAUDE_CODE_OAUTH_TOKEN=first\nCLAUDE_CODE_OAUTH_TOKEN=\n' >"$token"
chmod 600 "$token"
hapi_install_claude_oauth_dropin \
    --scope user \
    --runner-unit hapi-runner.service \
    --token-file "$token" >$TMP/hapi-claude-oauth-dropin-lastempty.out 2>$TMP/hapi-claude-oauth-dropin-lastempty.err
check "empty final assignment not reported present" \
    "! grep -q 'token file present' $TMP/hapi-claude-oauth-dropin-lastempty.out"
check "empty final assignment prints setup instructions" \
    "grep -q 'NOT configured yet' $TMP/hapi-claude-oauth-dropin-lastempty.out"

# Toggle resolves through ~/.local/bin symlink to the real scripts/tooling path.
toggle_link="$TMP/bin/hapi-claude-account-toggle"
ln -sf "$ROOT/scripts/tooling/hapi-claude-account-toggle.sh" "$toggle_link"
resolved_dir="$(cd "$(dirname "$(readlink -f "$toggle_link")")" && pwd)"
tooling_real="$(cd "$ROOT/scripts/tooling" && pwd -P)"
check "toggle symlink resolves to scripts/tooling" \
    "[[ \"$resolved_dir\" == \"$tooling_real\" ]]"
check "toggle symlink finds dropin lib" \
    "[[ -f \"$resolved_dir/lib/hapi-claude-oauth-dropin.sh\" ]]"

# Last-assignment-wins: empty final CLAUDE_CODE_OAUTH_TOKEN= is unconfigured.
dup="$TMP/dup-assign.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=first\nCLAUDE_CODE_OAUTH_TOKEN=\n' >"$dup"
chmod 600 "$dup"
set +e
hapi_claude_oauth_effective_token_value "$dup" >$TMP/hapi-claude-oauth-eff-empty.out 2>$TMP/hapi-claude-oauth-eff-empty.err
eff_empty_rc=$?
set -e
check "effective token rejects empty final assignment" "[[ $eff_empty_rc -ne 0 ]]"
printf 'CLAUDE_CODE_OAUTH_TOKEN=first\nCLAUDE_CODE_OAUTH_TOKEN=second\n' >"$dup"
got_eff="$(hapi_claude_oauth_effective_token_value "$dup")"
check "effective token uses last assignment" "[[ \"$got_eff\" == \"second\" ]]"

# Secure exclusive write refuses a pre-planted symlink destination.
bak_symlink="$TMP/auth-bak-symlink"
printf 'real\n' >"$TMP/auth-bak-real"
ln -s "$TMP/auth-bak-real" "$bak_symlink"
set +e
printf 'token-bytes\n' | hapi_claude_oauth_secure_write_new_file "$bak_symlink" \
    >$TMP/hapi-claude-oauth-excl.out 2>$TMP/hapi-claude-oauth-excl.err
excl_rc=$?
set -e
check "secure_write refuses symlink dst" "[[ $excl_rc -ne 0 ]]"
check "symlink dst target unchanged" "grep -qx real \"$TMP/auth-bak-real\""
bak_ok="$TMP/auth-bak-ok.env"
printf 'token-bytes\n' | hapi_claude_oauth_secure_write_new_file "$bak_ok"
check "secure_write creates exclusive file" "grep -qx token-bytes \"$bak_ok\""
set +e
printf 'again\n' | hapi_claude_oauth_secure_write_new_file "$bak_ok" 2>$TMP/hapi-claude-oauth-excl2.err
excl2_rc=$?
set -e
check "secure_write refuses existing dst" "[[ $excl2_rc -ne 0 ]]"

# Profile-scoped legacy candidates (fleet vs soup).
mapfile -t fleet_arr < <(hapi_claude_oauth_legacy_system_token_candidates fleet-binary)
fleet_joined=$'\n'"$(printf '%s\n' "${fleet_arr[@]}")"$'\n'
check "fleet candidates include /var/lib/hapi" \
    "[[ \"$fleet_joined\" == *$'\n'/var/lib/hapi/claude-setup-token.env$'\n'* ]]"
check "fleet candidates exclude operator home" \
    "[[ \"$fleet_joined\" != *$'\n'/home/heavygee/.hapi/claude-setup-token.env$'\n'* ]]"
mapfile -t fleet_custom < <(hapi_claude_oauth_legacy_system_token_candidates fleet-binary /srv/hapi-custom)
fleet_custom_joined=$'\n'"$(printf '%s\n' "${fleet_custom[@]}")"$'\n'
check "fleet --hapi-home candidates include custom home" \
    "[[ \"$fleet_custom_joined\" == *$'\n'/srv/hapi-custom/claude-setup-token.env$'\n'* ]]"
check "fleet --hapi-home still includes default /var/lib/hapi" \
    "[[ \"$fleet_custom_joined\" == *$'\n'/var/lib/hapi/claude-setup-token.env$'\n'* ]]"
mapfile -t soup_arr < <(hapi_claude_oauth_legacy_system_token_candidates primary-soup)
soup_joined=$'\n'"$(printf '%s\n' "${soup_arr[@]}")"$'\n'
check "soup candidates include operator home" \
    "[[ \"$soup_joined\" == *$'\n'/home/heavygee/.hapi/claude-setup-token.env$'\n'* ]]"
check "soup candidates exclude /var/lib/hapi by default" \
    "[[ \"$soup_joined\" != *$'\n'/var/lib/hapi/claude-setup-token.env$'\n'* ]]"
mapfile -t soup_op < <(hapi_claude_oauth_legacy_system_token_candidates primary-soup /var/lib/hapi /home/otherop)
soup_op_joined=$'\n'"$(printf '%s\n' "${soup_op[@]}")"$'\n'
check "soup --migrate-operator-home uses configured home" \
    "[[ \"$soup_op_joined\" == *$'\n'/home/otherop/.hapi/claude-setup-token.env$'\n'* ]]"
check "soup operator-home does not use sudoer HOME=/root" \
    "[[ \"$soup_op_joined\" != *$'\n'/root/.hapi/claude-setup-token.env$'\n'* ]]"
# Real primary-soup caller always passes HAPI_HOME=/var/lib/hapi — must NOT
# reintroduce fleet legacy paths into the soup candidate set.
check "soup with default HAPI_HOME excludes fleet /var/lib/hapi" \
    "[[ \"$soup_op_joined\" != *$'\n'/var/lib/hapi/claude-setup-token.env$'\n'* ]]"
check "soup with default HAPI_HOME excludes fleet /var/lib/hapi/.hapi" \
    "[[ \"$soup_op_joined\" != *$'\n'/var/lib/hapi/.hapi/claude-setup-token.env$'\n'* ]]"
mapfile -t soup_custom < <(hapi_claude_oauth_legacy_system_token_candidates primary-soup /srv/soup-custom /home/otherop)
soup_custom_joined=$'\n'"$(printf '%s\n' "${soup_custom[@]}")"$'\n'
check "soup custom HAPI_HOME is included" \
    "[[ \"$soup_custom_joined\" == *$'\n'/srv/soup-custom/claude-setup-token.env$'\n'* ]]"

# cat|install_bytes pipe (privileged-install pattern without mktemp SOURCE).
pipe_src="$TMP/pipe-src.env"
pipe_dst="$TMP/pipe-dst.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=from-pipe\n' >"$pipe_src"
chmod 600 "$pipe_src"
hapi_claude_oauth_cat_regular_file "$pipe_src" | hapi_claude_oauth_install_bytes "$pipe_dst"
check "cat|install_bytes copies token" "grep -qx 'CLAUDE_CODE_OAUTH_TOKEN=from-pipe' \"$pipe_dst\""
mode_pipe="$(stat -c '%a' "$pipe_dst")"
check "install_bytes sets 600" "[[ \"$mode_pipe\" == \"600\" ]]"
# Empty / ineffective payload must not wipe an existing destination.
printf 'CLAUDE_CODE_OAUTH_TOKEN=keep-me\n' >"$pipe_dst"
chmod 600 "$pipe_dst"
set +e
: | hapi_claude_oauth_install_bytes "$pipe_dst" >$TMP/hapi-claude-oauth-empty-pipe.out 2>$TMP/hapi-claude-oauth-empty-pipe.err
empty_pipe_rc=$?
set -e
check "empty pipe refuses replace" "[[ $empty_pipe_rc -ne 0 ]]"
check "empty pipe preserves destination" "grep -qx 'CLAUDE_CODE_OAUTH_TOKEN=keep-me' \"$pipe_dst\""
set +e
printf 'CLAUDE_CODE_OAUTH_TOKEN=\n' | hapi_claude_oauth_install_bytes "$pipe_dst" \
    >$TMP/hapi-claude-oauth-blank-assign.out 2>$TMP/hapi-claude-oauth-blank-assign.err
blank_rc=$?
set -e
check "blank assignment refuses replace" "[[ $blank_rc -ne 0 ]]"
check "blank assignment preserves destination" "grep -qx 'CLAUDE_CODE_OAUTH_TOKEN=keep-me' \"$pipe_dst\""

# Bash EnvironmentFile unescape (pet hosts without python3).
got_esc="$(hapi_claude_oauth_parse_env_file_value '"abc\$def"')"
if [[ "$got_esc" == 'abc$def' ]]; then echo "OK: double-quoted \\\$ unescapes to \$"; else
    echo "FAIL: double-quoted \\\$ unescapes to \$ (got=$got_esc)" >&2; exit 1
fi
raw_sq="$(python3 -c 'print(chr(39) + "abc\\$def" + chr(39))')"
got_esc2="$(hapi_claude_oauth_parse_env_file_value "$raw_sq")"
if [[ "$got_esc2" == 'abc\$def' ]]; then echo "OK: single-quoted keeps backslash"; else
    echo "FAIL: single-quoted keeps backslash (got=$got_esc2)" >&2; exit 1
fi
# Force bash path of effective_token_value (PATH with no python3).
esc_file="$TMP/esc-token.env"
printf '%s\n' 'CLAUDE_CODE_OAUTH_TOKEN="abc\$def"' >"$esc_file"
chmod 600 "$esc_file"
no_py="$TMP/no-python-bin"
mkdir -p "$no_py"
got_eff_esc="$(PATH="$no_py" hapi_claude_oauth_effective_token_value "$esc_file")"
if [[ "$got_eff_esc" == 'abc$def' ]]; then echo "OK: bash effective_token_value unescapes quoted \\\$"; else
    echo "FAIL: bash effective_token_value unescapes (got=$got_eff_esc)" >&2; exit 1
fi

# Toggle must not PATH-inject bash / source checkout under sudo.
check "toggle uses install_bytes_via_sudo" \
    "grep -q 'hapi_claude_oauth_install_bytes_via_sudo' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle does not PATH-inject bash under sudo" \
    "! grep -E 'sudo.*PATH=.*bash' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle validates credentials JSON before mutation" \
    "grep -q 'invalid JSON in slot credentials' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle rolls back canon on credentials failure" \
    "grep -q 'hapi_claude_oauth_rollback_canon_from_bak' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle removes newly created canon on rollback" \
    "grep -q 'secure_unlink_regular_file' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle tracks canon_existed_before" \
    "grep -q 'canon_existed_before=0' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle restores empty canon via restore_bytes" \
    "grep -q 'hapi_claude_oauth_restore_bytes_via_sudo' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle rolls back interactive credentials" \
    "grep -q 'hapi_claude_oauth_rollback_credentials' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "toggle continues credentials rollback after canon rollback" \
    "grep -B1 'rollback_canon_from_bak \"cannot replace' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\" | grep -q 'set +e'"
check "retire failure marks migrate pending" \
    "grep -A3 'could not retire legacy source' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\" | grep -q 'MIGRATE_PENDING=1'"
check "secure_copy has bash fallback for non-/etc" \
    "grep -q 'Bash fallback for same-user pet hosts' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "pet does not source oauth env file" \
    "! grep -E '\\. \\\"\\\$HAPI_HOME/claude-setup-token|set -a; \\. ' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet exports oauth via parser helper" \
    "grep -q 'hapi_pet_export_oauth_from_env_file' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet embedded path migrates legacy oauth before drop-in" \
    "grep -q 'hapi_pet_migrate_legacy_oauth_if_needed' \"$ROOT/scripts/install-hapi-pet.sh\""
check "verify parent check does not use fixed /tmp paths" \
    "! grep -E '/tmp/hapi-verify-oauth-parent\\.(out|err)' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "secure_copy retries short writes" \
    "grep -q 'write returned %d with %d bytes remaining' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "companion passes --unit-dir for user-pet drop-in" \
    "grep -q -- '--unit-dir' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "oauth drop-in install precedes watchdog tier1" \
    "awk '/^[[:space:]]+hapi_install_claude_oauth_dropin/ && !d {d=NR} /^[[:space:]]+bash .*install-hapi-primary-hub-tier1\\.sh/ {t=NR} END {exit !(d && t && d<t)}' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "installer stops watchdog timer before unit rewrite" \
    "grep -q 'Quiesce a pre-existing watchdog' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\" && grep -q 'stop hapi-runner-watchdog.timer' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "verify oauth gate precedes watchdog kick" \
    "awk '/^OAUTH_RESTART_SAFE=1/ {o=NR} /start hapi-runner-watchdog.service/ {w=NR} END {exit !(o && w && o<w)}' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify skips watchdog kick when oauth unsafe" \
    "grep -q 'skipped watchdog kick' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify audits watchdog fragments before kick" \
    "grep -q 'hapi-runner-watchdog.service' \"$ROOT/scripts/tooling/verify-hapi-install.sh\" && grep -q 'hapi_verify_audit_loaded_fragments \"hapi-runner-watchdog.service\"' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify audits fragment parent directories" \
    "grep -q 'hapi_claude_oauth_assert_root_controlled_ancestors' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify rejects writable later EnvironmentFiles" \
    "grep -q 'later EnvironmentFile is group/other-writable' \"$ROOT/scripts/tooling/verify-hapi-install.sh\" && grep -q 'later EnvironmentFile is not root-owned' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "installer fails closed if watchdog timer restore fails" \
    "grep -q 'failed to restore hapi-runner-watchdog.timer' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\" && ! grep -q 'start hapi-runner-watchdog.timer 2>/dev/null || true' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "verify refuses later EnvironmentFile oauth override" \
    "grep -q 'overrides CLAUDE_CODE_OAUTH_TOKEN after canonical token' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "installer checks ambient oauth before watchdog tier1" \
    "python3 -c 't=open(\"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\").read(); c=t.find(\"if hapi_system_runner_ambient_oauth_unpersisted\"); n=t.find(\"install-hapi-primary-hub-tier1.sh\\\"\"); raise SystemExit(0 if 0<=c<n else 1)'"
check "toggle rejects symlink slot credentials" \
    "grep -q 'refusing symlink slot credentials' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "effective token parser joins EnvironmentFile continuations" \
    "grep -q 'coalesce_env_lines' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "verify validates system drop-in before restart" \
    "awk '/SYSTEM_OAUTH_SAFE=1/,/SKIP_RESTART/ { if (/refusing restart/) { found=1; exit } } END { exit !found }' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify validates drop-in directory even when file absent" \
    "grep -q 'drop-in directory must be root-controlled' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify validates token before restart" \
    "grep -q 'token file must be root:root 0600 before restart' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify refuses restart when token not in EnvironmentFiles" \
    "grep -q 'not wired into' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "pet systemd path restarts hub on upgrade" \
    "grep -q 'systemctl --user restart hapi-hub.service' \"$ROOT/scripts/install-hapi-pet.sh\""
check "toggle rejects non-regular interactive credentials" \
    "grep -q 'refusing non-regular interactive credentials' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "secure_copy uses no-follow dirfds" \
    "grep -q 'open_via_nofollow_dirfds' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "secure_copy bounds legacy token size" \
    "grep -q 'MAX_TOKEN_BYTES' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""

# Symlink ancestor on legacy migrate source must fail closed.
anc_root="$TMP/anc-root"
mkdir -p "$anc_root/real/.hapi" "$anc_root/fleet"
printf 'CLAUDE_CODE_OAUTH_TOKEN=stolen\n' >"$anc_root/real/.hapi/claude-setup-token.env"
chmod 600 "$anc_root/real/.hapi/claude-setup-token.env"
ln -s "$anc_root/real/.hapi" "$anc_root/fleet/.hapi"
set +e
hapi_claude_oauth_assert_no_symlink_ancestors "$anc_root/fleet/.hapi/claude-setup-token.env" \
    >"$TMP/anc.out" 2>"$TMP/anc.err"
anc_rc=$?
set -e
check "symlink ancestor rejected" "[[ $anc_rc -ne 0 ]]"
check "symlink ancestor names component" "grep -q 'refusing symlink path component' \"$TMP/anc.err\""
set +e
hapi_claude_oauth_secure_copy_regular_file \
    "$anc_root/fleet/.hapi/claude-setup-token.env" "$anc_root/canon.env" \
    >"$TMP/anc-copy.out" 2>"$TMP/anc-copy.err"
anc_copy_rc=$?
set -e
check "secure_copy refuses symlink ancestor source" "[[ $anc_copy_rc -ne 0 ]]"
check "secure_copy did not create canon from symlink ancestor" "[[ ! -e \"$anc_root/canon.env\" ]]"

# Oversized legacy source must fail before buffering into privileged migrate.
big_src="$TMP/big-legacy.env"
# Sparse-ish: write >64KiB of filler with a token assignment prefix.
{
    printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(head -c 200 </dev/urandom | base64 | tr -d '\n')"
    head -c $((70 * 1024)) </dev/zero | tr '\0' 'x'
    printf '\n'
} >"$big_src"
chmod 600 "$big_src"
set +e
hapi_claude_oauth_secure_copy_regular_file "$big_src" "$TMP/big-canon.env" \
    >"$TMP/big.out" 2>"$TMP/big.err"
big_rc=$?
set -e
check "oversized legacy token refused" "[[ $big_rc -ne 0 ]]"
check "oversized legacy names size limit" "grep -Eiq 'too large|exceeded' \"$TMP/big.err\""
check "oversized legacy did not create destination" "[[ ! -e \"$TMP/big-canon.env\" ]]"

# --unit-dir overrides XDG_CONFIG_HOME for user drop-in placement.
unit_home="$TMP/unit-dir-home"
mkdir -p "$unit_home/.config/systemd/user"
export XDG_CONFIG_HOME="$TMP/xdg-wrong"
mkdir -p "$XDG_CONFIG_HOME"
unit_token="$TMP/unit-dir-token.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=unitdir\n' >"$unit_token"
chmod 600 "$unit_token"
hapi_install_claude_oauth_dropin \
    --scope user --runner-unit hapi-runner.service \
    --token-file "$unit_token" \
    --unit-dir "$unit_home/.config/systemd/user" \
    >"$TMP/unit-dir.out" 2>"$TMP/unit-dir.err"
check "unit-dir drop-in beside HOME unit root" \
    "[[ -f \"$unit_home/.config/systemd/user/hapi-runner.service.d/42-claude-oauth-token.conf\" ]]"
check "unit-dir ignores XDG_CONFIG_HOME" \
    "[[ ! -e \"$XDG_CONFIG_HOME/systemd/user/hapi-runner.service.d/42-claude-oauth-token.conf\" ]]"

# Embedded pet migrate (curl|bash shape — no drop-in helpers).
pet_home="$TMP/pet-migrate-home"
mkdir -p "$pet_home/.hapi"
printf 'CLAUDE_CODE_OAUTH_TOKEN=pet-legacy\n' >"$pet_home/.hapi/claude-setup-token.env"
chmod 600 "$pet_home/.hapi/claude-setup-token.env"
pet_frag="$TMP/pet-migrate-frag.sh"
{
    cat <<'FRAG'
set -euo pipefail
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
log() { printf '==> %s\n' "$1"; }
FRAG
    # Extract helpers without executing the install body that follows them.
    awk '
      /^hapi_pet_export_oauth_from_env_file\(\)/ {keep=1}
      /^hapi_pet_migrate_legacy_oauth_if_needed\(\)/ {keep=1}
      /^install_user_pet_systemd\(\)/ {keep=0}
      keep {print}
    ' "$ROOT/scripts/install-hapi-pet.sh"
    printf 'hapi_pet_migrate_legacy_oauth_if_needed %q\n' "$pet_home/claude-setup-token.env"
} >"$pet_frag"
bash "$pet_frag" >"$TMP/pet-migrate-test.out" 2>"$TMP/pet-migrate-test.err"
check "pet migrate copies legacy to canonical" \
    "grep -q 'CLAUDE_CODE_OAUTH_TOKEN=pet-legacy' \"$pet_home/claude-setup-token.env\""
check "pet migrate retires legacy source" \
    "[[ ! -e \"$pet_home/.hapi/claude-setup-token.env\" ]]"
check "pet migrate archives retired legacy" \
    "ls \"$pet_home/.hapi/claude-setup-token.env.migrated.\"* >/dev/null 2>&1"
check "pet migrate logs Migrated" \
    "grep -q 'Migrated Claude OAuth token' \"$TMP/pet-migrate-test.out\""
check "systemd install blocks ambient-only restart" \
    "grep -q 'ambient CLAUDE_CODE_OAUTH_TOKEN' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "user-pet install blocks ambient-only restart" \
    "grep -q 'hapi_user_pet_refuse_ambient_only_restart' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""
check "pet preflight checks symlink ancestors" \
    "grep -q '_preflight_token_ancestors' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet preflight blocks ambient-only stop" \
    "grep -q 'refuse stop/restart; persist the token first' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet preflight runs without --with-systemd for canonical" \
    "awk '/_preflight_token_shape \"\\\$\{HAPI_HOME\}\/claude-setup-token.env\"/ {found=1; exit} END {exit !found}' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet migrates legacy oauth before stop for nohup" \
    "awk '/hapi_pet_migrate_legacy_oauth_if_needed \"\\\$\{HAPI_HOME\}\/claude-setup-token.env\"/ {found=1; exit} END {exit !found}' \"$ROOT/scripts/install-hapi-pet.sh\""
check "pet nohup launch migrates legacy before export" \
    "awk '/Without: nohup/,/Runner started/ {print}' \"$ROOT/scripts/install-hapi-pet.sh\" | grep -q 'hapi_pet_migrate_legacy_oauth_if_needed'"
check "verify refuses ambient-only restart" \
    "grep -q 'has ambient CLAUDE_CODE_OAUTH_TOKEN but' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify peer detection requires cgroup association" \
    "grep -q 'cgroup_related' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify validates every system drop-in conf before restart" \
    "grep -q 'unsafe drop-in' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "pet embeds systemd EnvironmentFile unescape" \
    "grep -q 'Unquoted: \\\\X' \"$ROOT/scripts/install-hapi-pet.sh\""
check "toggle rejects active credentials symlink" \
    "grep -q 'refusing symlink interactive credentials' \"$ROOT/scripts/tooling/hapi-claude-account-toggle.sh\""
check "drop-in retires legacy even when canon already effective" \
    "grep -q 'retry retirement' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "retire function returns 1 on python failure" \
    "awk '/^hapi_claude_oauth_retire_legacy_token_source/,/^}/ {print}' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\" | grep -q 'return 1'"

# restore_bytes must accept empty/ineffective payloads (toggle rollback of empty canon).
restore_dst="$TMP/restore-empty.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=new\n' >"$restore_dst"
chmod 600 "$restore_dst"
: | hapi_claude_oauth_restore_bytes "$restore_dst"
check "restore_bytes accepts empty payload" "[[ -f \"$restore_dst\" ]]"
check "restore_bytes empty clears prior content" "! grep -q 'CLAUDE_CODE_OAUTH_TOKEN=new' \"$restore_dst\""
printf 'CLAUDE_CODE_OAUTH_TOKEN=\n' | hapi_claude_oauth_restore_bytes "$restore_dst"
check "restore_bytes accepts blank assignment" "grep -q 'CLAUDE_CODE_OAUTH_TOKEN=' \"$restore_dst\""

# retire must return nonzero when rename cannot succeed (dest already exists).
# Root ignores chmod a-w on the parent; collide dest with a frozen `date +%s`.
retire_src="$TMP/retire-src.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=legacy\n' >"$retire_src"
chmod 600 "$retire_src"
retire_ro="$TMP/retire-ro"
mkdir -p "$retire_ro"
printf 'CLAUDE_CODE_OAUTH_TOKEN=x\n' >"$retire_ro/token.env"
chmod 600 "$retire_ro/token.env"
touch "$retire_ro/token.env.migrated.9999999999"
mkdir -p "$TMP/datebin"
printf '%s\n' '#!/usr/bin/env bash' 'echo 9999999999' >"$TMP/datebin/date"
chmod +x "$TMP/datebin/date"
set +e
PATH="$TMP/datebin:$PATH" hapi_claude_oauth_retire_legacy_token_source "$retire_ro/token.env" \
    >"$TMP/hapi-claude-oauth-retire-ro.out" 2>"$TMP/hapi-claude-oauth-retire-ro.err"
retire_rc=$?
set -e
check "retire returns nonzero when archive rename fails" "[[ $retire_rc -ne 0 ]]"
check "retire leaves source when rename fails" "[[ -f \"$retire_ro/token.env\" ]]"

# Bash secure_copy fallback (no python3 on PATH) for user-pet migrate.
bash_copy_src="$TMP/bash-copy-src.env"
bash_copy_dst="$TMP/bash-copy-dst.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=bash-copy\n' >"$bash_copy_src"
chmod 600 "$bash_copy_src"
no_py2="$TMP/no-python-bin2"
mkdir -p "$no_py2"
PATH="$no_py2" hapi_claude_oauth_secure_copy_regular_file "$bash_copy_src" "$bash_copy_dst"
check "bash secure_copy copies token" "grep -qx 'CLAUDE_CODE_OAUTH_TOKEN=bash-copy' \"$bash_copy_dst\""
mode_bash="$(stat -c '%a' "$bash_copy_dst")"
check "bash secure_copy sets 600" "[[ \"$mode_bash\" == \"600\" ]]"
set +e
PATH="$no_py2" hapi_claude_oauth_secure_copy_regular_file "$bash_copy_src" /etc/hapi/should-fail.env \
    >$TMP/hapi-claude-oauth-bash-etc.out 2>$TMP/hapi-claude-oauth-bash-etc.err
bash_etc_rc=$?
set -e
check "bash secure_copy refuses /etc without python3" "[[ $bash_etc_rc -ne 0 ]]"

# Invocation-only: the wrong helper name must not appear as a call site.
check "retired remigrate uses hapi_install_claude_oauth_dropin" \
    "grep -n 'hapi_install_claude_oauth_dropin' \"$ROOT/scripts/tooling/hapi-claude-oauth-dropin.test.sh\" | grep -q remigrate"
check "no call to nonexistent hapi_claude_oauth_install_dropin" \
    "! grep -E '^[[:space:]]*hapi_claude_oauth_install_dropin([[:space:]]|$)' \"$ROOT/scripts/tooling/hapi-claude-oauth-dropin.test.sh\""
toggle_json_line="$(grep -n 'invalid JSON in slot credentials' "$ROOT/scripts/tooling/hapi-claude-account-toggle.sh" | head -1 | cut -d: -f1)"
toggle_cp_line="$(grep -n 'cp -a "$CRED"' "$ROOT/scripts/tooling/hapi-claude-account-toggle.sh" | head -1 | cut -d: -f1)"
check "toggle JSON validate precedes credentials cp" \
    "[[ -n \"$toggle_json_line\" && -n \"$toggle_cp_line\" && \"$toggle_json_line\" -lt \"$toggle_cp_line\" ]]"
check "install_bytes_via_sudo uses absolute python3" \
    "grep -q 'hapi_claude_oauth_absolute_python3' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "install_bytes_via_sudo sanitizes env" \
    "grep -q 'env -i PATH=/usr/bin:/bin' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "drop-in install returns on write failure" \
    "grep -q 'failed to write temporary drop-in' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""
check "drop-in install returns on install failure" \
    "grep -q 'failed to install drop-in' \"$ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh\""

# Secure unlink (new-canon rollback path).
unlink_target="$TMP/unlink-me.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=bye\n' >"$unlink_target"
chmod 600 "$unlink_target"
hapi_claude_oauth_secure_unlink_regular_file "$unlink_target"
check "secure_unlink removes regular file" "[[ ! -e \"$unlink_target\" ]]"
unlink_sym="$TMP/unlink-sym.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=keep\n' >"$TMP/unlink-real.env"
ln -s "$TMP/unlink-real.env" "$unlink_sym"
set +e
hapi_claude_oauth_secure_unlink_regular_file "$unlink_sym" \
    >$TMP/hapi-claude-oauth-unlink-sym.out 2>$TMP/hapi-claude-oauth-unlink-sym.err
unlink_sym_rc=$?
set -e
check "secure_unlink refuses symlink" "[[ $unlink_sym_rc -ne 0 ]]"
check "secure_unlink leaves symlink target" "grep -qx 'CLAUDE_CODE_OAUTH_TOKEN=keep' \"$TMP/unlink-real.env\""

# Drop-in write failure must surface even when caller uses set +e (installer pattern).
# Root ignores chmod a-w; a regular file as --unit-dir makes mkdir -p fail for anyone.
ro_unit="$TMP/ro-unit-dir-file"
printf 'not-a-directory\n' >"$ro_unit"
set +e
hapi_install_claude_oauth_dropin \
    --scope user --runner-unit hapi-runner.service \
    --unit-dir "$ro_unit" \
    --token-file "$TMP/missing-token.env" \
    >"$TMP/hapi-claude-oauth-ro-dropin.out" 2>"$TMP/hapi-claude-oauth-ro-dropin.err"
ro_rc=$?
set -e
check "drop-in write failure returns nonzero under set +e" "[[ $ro_rc -ne 0 ]]"

# Existing non-root-owned "system" parent must fail closed.
bad_parent="$TMP/fake-etc-hapi"
mkdir -m 0775 -p "$bad_parent"
set +e
hapi_claude_oauth_assert_root_controlled_parent "$bad_parent" \
    >$TMP/hapi-claude-oauth-parent.out 2>$TMP/hapi-claude-oauth-parent.err
parent_rc=$?
set -e
check "assert_root_controlled rejects non-root parent" "[[ $parent_rc -ne 0 ]]"
check "assert_root_controlled mentions ownership or writable" \
    "grep -Eiq 'owned by uid|group/other-writable' $TMP/hapi-claude-oauth-parent.err"
check "ancestor walker is exported from dropin lib" \
    "declare -F hapi_claude_oauth_assert_root_controlled_ancestors >/dev/null"

# systemd EnvironmentFile unescape (unquoted \X → X; whitespace then quotes).
got="$(hapi_claude_oauth_parse_env_file_value 'abc\def')"
check "parse unquoted backslash strips" "[[ \"$got\" == \"abcdef\" ]]"
got="$(hapi_claude_oauth_parse_env_file_value '  "quoted"  ')"
check "parse strips outer whitespace before quotes" "[[ \"$got\" == \"quoted\" ]]"

# Canon already effective + leftover legacy → retry retirement (not need_migrate=0 no-op).
retry_home="$TMP/retry-retire"
mkdir -p "$retry_home/.hapi"
printf 'CLAUDE_CODE_OAUTH_TOKEN=canon\n' >"$retry_home/claude-setup-token.env"
chmod 600 "$retry_home/claude-setup-token.env"
printf 'CLAUDE_CODE_OAUTH_TOKEN=stale\n' >"$retry_home/.hapi/claude-setup-token.env"
chmod 600 "$retry_home/.hapi/claude-setup-token.env"
set +e
hapi_install_claude_oauth_dropin \
    --scope user --runner-unit hapi-runner.service \
    --token-file "$retry_home/claude-setup-token.env" \
    >$TMP/hapi-claude-oauth-retry-retire.out 2>$TMP/hapi-claude-oauth-retry-retire.err
retry_rc=$?
set -e
check "retry retirement succeeds with effective canon" "[[ $retry_rc -eq 0 ]]"
check "retry retirement archives leftover legacy" \
    "[[ ! -e \"$retry_home/.hapi/claude-setup-token.env\" ]]"
check "retry retirement keeps canon value" \
    "grep -q 'CLAUDE_CODE_OAUTH_TOKEN=canon' \"$retry_home/claude-setup-token.env\""
check "retry retirement logs Retired" \
    "grep -q 'Retired legacy Claude OAuth token' $TMP/hapi-claude-oauth-retry-retire.out"

# systemd EnvironmentFile line continuation (unquoted trailing \ eats newline).
cont_file="$TMP/cont-token.env"
printf '%s\n' 'CLAUDE_CODE_OAUTH_TOKEN=abc\' 'def' >"$cont_file"
chmod 600 "$cont_file"
got="$(hapi_claude_oauth_effective_token_value "$cont_file")"
check "effective token joins unquoted continuation" "[[ \"$got\" == \"abcdef\" ]]"
check "continuation file is treated as durable" "hapi_claude_oauth_has_effective_token \"$cont_file\""
qfile="$TMP/quoted-cont.env"
printf '%s\n' 'CLAUDE_CODE_OAUTH_TOKEN="abc' 'def"' >"$qfile"
chmod 600 "$qfile"
got_q="$(PATH="$no_py" hapi_claude_oauth_effective_token_value "$qfile")"
if [[ "$got_q" == $'abc\ndef' ]]; then echo "OK: bash fallback joins quoted EnvironmentFile newlines"; else
    echo "FAIL: bash fallback quoted newline (got=$(printf %q "$got_q"))" >&2; exit 1
fi
check "pet embedded parser tracks quoted continuations" \
    "grep -q 'hapi_claude_oauth_env_line_state' \"$ROOT/scripts/install-hapi-pet.sh\""
check "verify UnsetEnvironment refuses restart" \
    "grep -q 'UnsetEnvironment removes CLAUDE_CODE_OAUTH_TOKEN' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "verify later EnvironmentFile root-control is system-scope" \
    "python3 -c 'from pathlib import Path; t=Path(\"$ROOT/scripts/tooling/verify-hapi-install.sh\").read_text(); i=t.find(\"later EnvironmentFile parent is not root-controlled\"); c=t[max(0,i-250):i]; raise SystemExit(0 if \"SCOPE\" in c and \"system\" in c else 1)'"
check "verify user token requires runner-owned 0600" \
    "grep -q 'user Claude OAuth token must be owned by the runner account mode 0600' \"$ROOT/scripts/tooling/verify-hapi-install.sh\""
check "installer fails closed if watchdog quiesce fails" \
    "grep -q 'failed to stop hapi-runner-watchdog.timer before unit rewrite' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\" && ! grep -q 'stop hapi-runner-watchdog.timer 2>/dev/null || true' \"$ROOT/scripts/tooling/install-hapi-systemd-units.sh\""

echo "ALL OK"
