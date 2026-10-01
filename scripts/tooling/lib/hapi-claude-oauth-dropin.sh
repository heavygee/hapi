#!/usr/bin/env bash
# hapi-claude-oauth-dropin.sh — install the runner Claude OAuth EnvironmentFile drop-in.
#
# UI machine spawn does NOT send options.token. New Claude sessions inherit the
# runner process environment. Without CLAUDE_CODE_OAUTH_TOKEN in that env (via
# systemd EnvironmentFile), fresh sessions print "Not logged in · Please run /login"
# while long-lived --resume children keep working and hide the gap.
#
# Canon: docs/plans/2026-09-04-fleet-vm-swap-strategy.md §1 (2026-10-01 row).
# oos-linux's 42-claude-oauth-token.conf (2026-08-25) was hand-installed; this
# library makes the same shape a first-class install step for fleet + pet.
#
# Usage (sourced):
#   source scripts/tooling/lib/hapi-claude-oauth-dropin.sh
#   hapi_install_claude_oauth_dropin \
#       --scope system|user \
#       --runner-unit hapi-runner.service \
#       --token-file /var/lib/hapi/claude-setup-token.env \
#       [--owner hapi:hapi]
#
# Idempotent. Does not mint Anthropic tokens. If the env file is missing, prints
# a clear one-time setup instruction and still installs the drop-in (systemd's
# EnvironmentFile=- form ignores a missing file so the unit still starts).

hapi_claude_oauth_default_token_file() {
    local hapi_home="${1:?hapi_home}"
    # Prefer $HAPI_HOME/claude-setup-token.env. Accept legacy
    # $HAPI_HOME/.hapi/claude-setup-token.env if that already exists (antevorta
    # 2026-10-01 hotfix path) so re-running the installer does not strand it.
    local canonical="$hapi_home/claude-setup-token.env"
    local legacy="$hapi_home/.hapi/claude-setup-token.env"
    if [[ -f "$legacy" && ! -f "$canonical" ]]; then
        printf '%s' "$legacy"
        return 0
    fi
    printf '%s' "$canonical"
}

hapi_print_claude_oauth_setup_instructions() {
    local token_file="${1:?token_file}"
    local runner_unit="${2:-hapi-runner.service}"
    local scope="${3:-system}"
    local restart_cmd
    case "$scope" in
        user) restart_cmd="systemctl --user restart ${runner_unit}" ;;
        *)    restart_cmd="systemctl restart ${runner_unit}" ;;
    esac
    cat <<EOF

==> Claude OAuth for runner-spawned sessions is NOT configured yet.
    New UI / machine-spawn Claude sessions will print:
      Not logged in · Please run /login
    Existing --resume sessions can keep working and hide this gap.

    One-time setup (as the runner account, with a browser available):
      claude setup-token
    Then write the printed token (do not commit it):
      umask 077
      printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' > '$token_file'
      chmod 600 '$token_file'
    And reload the runner:
      $restart_cmd

    Drop-in already points at: $token_file
EOF
}

hapi_claude_oauth_assert_safe_token_file() {
    # Refuse symlinks / non-regular files before root chmod/chown. A compromised
    # runner account could point claude-setup-token.env at /etc/sudoers; [[ -f ]],
    # chmod, and chown all follow symlinks.
    local token_file="${1:?token_file}"
    if [[ -L "$token_file" ]]; then
        echo "ERROR: refusing symlink token file: $token_file" >&2
        echo "       Remove the symlink and write a regular file (0600)." >&2
        return 1
    fi
    if [[ -e "$token_file" && ! -f "$token_file" ]]; then
        echo "ERROR: refusing non-regular token file: $token_file" >&2
        return 1
    fi
    return 0
}

# chmod 0600 (+ optional chown) without following a symlink final component.
# Prefer python3 O_NOFOLLOW + fchmod/fchown. Path-based shell chmod/chown is
# only allowed for user-scope (no --owner): system-profile as root must fail
# closed without python3 rather than risk a TOCTOU symlink retarget.
hapi_claude_oauth_secure_chmod_chown() {
    local token_file="${1:?token_file}"
    local owner="${2:-}"

    hapi_claude_oauth_assert_safe_token_file "$token_file" || return 1

    if [[ -z "${HAPI_CLAUDE_OAUTH_FORCE_SHELL:-}" ]] && command -v python3 >/dev/null 2>&1; then
        python3 - "$token_file" "$owner" <<'PY'
import grp, os, pwd, stat, sys

path = sys.argv[1]
owner = sys.argv[2] if len(sys.argv) > 2 else ""

flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW

try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write(
        "ERROR: cannot open token file without following symlink: %s: %s\n" % (path, exc)
    )
    sys.exit(1)

try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular token file: %s\n" % path)
        sys.exit(1)
    os.fchmod(fd, 0o600)
    if owner:
        user, sep, group = owner.partition(":")
        try:
            uid = pwd.getpwnam(user).pw_uid
            if sep and group:
                gid = grp.getgrnam(group).gr_gid
            else:
                gid = pwd.getpwnam(user).pw_gid
        except KeyError as exc:
            sys.stderr.write("ERROR: unknown owner %r: %s\n" % (owner, exc))
            sys.exit(1)
        os.fchown(fd, uid, gid)
finally:
    os.close(fd)
sys.exit(0)
PY
        return $?
    fi

    # System profile (owner set) runs as root — never path-based chmod/chown.
    if [[ -n "$owner" ]]; then
        echo "ERROR: python3 required to securely chmod/chown token file as root: $token_file" >&2
        echo "       Install python3, or write the token as the runner user after drop-in install." >&2
        return 1
    fi

    # User-scope pet fallback (not root): operator owns the file; TOCTOU cannot
    # retarget a root-owned path. Still refuse symlinks up front.
    chmod 600 "$token_file" || return 1
    if [[ -L "$token_file" ]]; then
        echo "ERROR: token file became a symlink during chmod: $token_file" >&2
        return 1
    fi
    return 0
}

# Best-effort chown of the token parent dir via O_DIRECTORY|O_NOFOLLOW + fchown.
# Skips (WARN) when python3 is missing or the parent is a symlink.
hapi_claude_oauth_secure_chown_parent() {
    local parent_dir="${1:?parent_dir}"
    local owner="${2:?owner}"
    if [[ -L "$parent_dir" ]]; then
        echo "WARN: token parent dir is a symlink; skipping chown of $parent_dir" >&2
        return 0
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "WARN: python3 missing; skipping chown of token parent $parent_dir" >&2
        return 0
    fi
    python3 - "$parent_dir" "$owner" <<'PY'
import grp, os, pwd, stat, sys

path = sys.argv[1]
owner = sys.argv[2]
flags = os.O_RDONLY
if hasattr(os, "O_DIRECTORY"):
    flags |= os.O_DIRECTORY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("WARN: cannot open token parent without following symlink: %s: %s\n" % (path, exc))
    sys.exit(0)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISDIR(mode):
        sys.stderr.write("WARN: token parent is not a directory; skipping chown: %s\n" % path)
        sys.exit(0)
    user, sep, group = owner.partition(":")
    try:
        uid = pwd.getpwnam(user).pw_uid
        gid = grp.getgrnam(group).gr_gid if sep and group else pwd.getpwnam(user).pw_gid
    except KeyError as exc:
        sys.stderr.write("WARN: unknown owner %r for parent chown: %s\n" % (owner, exc))
        sys.exit(0)
    os.fchown(fd, uid, gid)
finally:
    os.close(fd)
sys.exit(0)
PY
}

# Install drop-in. Returns 0 always when drop-in written; prints instructions
# (and returns 0) when the token file is absent — absence is expected on a
# stranger pet install until the operator mints a token.
hapi_install_claude_oauth_dropin() {
    local scope="" runner_unit="" token_file="" owner=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --scope) scope="${2:?}"; shift 2 ;;
            --runner-unit) runner_unit="${2:?}"; shift 2 ;;
            --token-file) token_file="${2:?}"; shift 2 ;;
            --owner) owner="${2:?}"; shift 2 ;;
            *)
                echo "hapi_install_claude_oauth_dropin: unknown arg: $1" >&2
                return 2
                ;;
        esac
    done
    [[ -n "$scope" && -n "$runner_unit" && -n "$token_file" ]] || {
        echo "hapi_install_claude_oauth_dropin: --scope --runner-unit --token-file required" >&2
        return 2
    }

    local dropin_dir dropin
    case "$scope" in
        system)
            dropin_dir="/etc/systemd/system/${runner_unit}.d"
            ;;
        user)
            dropin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${runner_unit}.d"
            ;;
        *)
            echo "hapi_install_claude_oauth_dropin: --scope must be system|user" >&2
            return 2
            ;;
    esac
    dropin="$dropin_dir/42-claude-oauth-token.conf"

    mkdir -p "$dropin_dir"
    # Parent of the token file (may not exist yet on a fresh box).
    mkdir -p "$(dirname "$token_file")"
    if [[ -n "$owner" && "$scope" == system ]]; then
        # Best-effort chown of the parent dir so the runner user can write the
        # token later without root. FD-based (O_NOFOLLOW) — never path chown.
        hapi_claude_oauth_secure_chown_parent "$(dirname "$token_file")" "$owner"
    fi

    cat >"$dropin" <<EOF
# Installed by hapi_install_claude_oauth_dropin (scripts/tooling/lib/hapi-claude-oauth-dropin.sh).
# Leading '-' = ignore missing file so the unit still starts before the operator
# mints a setup-token. verify-hapi-install.sh fails the ambient-token check when
# live Claude children have a token and the runner does not.
[Service]
EnvironmentFile=-${token_file}
EOF
    chmod 0644 "$dropin"
    echo "Installed: $dropin -> EnvironmentFile=-$token_file"

    if [[ -e "$token_file" || -L "$token_file" ]]; then
        # Fast-path clear error for an obvious symlink; the secure helper also
        # refuses via O_NOFOLLOW so a TOCTOU swap cannot retarget chmod/chown.
        hapi_claude_oauth_assert_safe_token_file "$token_file" || return 1
        if [[ -n "$owner" && "$scope" == system ]]; then
            hapi_claude_oauth_secure_chmod_chown "$token_file" "$owner" || return 1
        else
            hapi_claude_oauth_secure_chmod_chown "$token_file" || return 1
        fi
        if grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.' "$token_file" 2>/dev/null; then
            echo "Claude OAuth token file present: $token_file"
        else
            echo "WARN: $token_file exists but has no CLAUDE_CODE_OAUTH_TOKEN= line" >&2
            hapi_print_claude_oauth_setup_instructions "$token_file" "$runner_unit" "$scope"
        fi
    else
        hapi_print_claude_oauth_setup_instructions "$token_file" "$runner_unit" "$scope"
    fi

    case "$scope" in
        system) systemctl daemon-reload ;;
        user) systemctl --user daemon-reload ;;
    esac
}
