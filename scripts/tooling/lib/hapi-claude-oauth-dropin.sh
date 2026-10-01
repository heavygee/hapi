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
    # Canonical only: $HAPI_HOME/claude-setup-token.env.
    # The antevorta 2026-10-01 hotfix under $HAPI_HOME/.hapi/ is a one-time
    # operational migrate (cp to canonical), not a retained dual-path.
    printf '%s' "$hapi_home/claude-setup-token.env"
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
# FIFO/socket races: O_RDONLY alone can block forever on a FIFO planted after
# the regular-file check; NONBLOCK lets fstat reject non-regular files.
if hasattr(os, "O_NONBLOCK"):
    flags |= os.O_NONBLOCK

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
# Returns 1 when ownership cannot be applied (caller must fail closed on system
# installs so the runner account can still write the token file).
hapi_claude_oauth_secure_chown_parent() {
    local parent_dir="${1:?parent_dir}"
    local owner="${2:?owner}"
    if [[ -L "$parent_dir" ]]; then
        echo "ERROR: token parent dir is a symlink; refusing chown of $parent_dir" >&2
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "ERROR: python3 is required to securely chown token parent $parent_dir" >&2
        echo "       Install python3, or pre-create $parent_dir owned by $owner." >&2
        return 1
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
    sys.stderr.write("ERROR: cannot open token parent without following symlink: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISDIR(mode):
        sys.stderr.write("ERROR: token parent is not a directory: %s\n" % path)
        sys.exit(1)
    user, sep, group = owner.partition(":")
    try:
        uid = pwd.getpwnam(user).pw_uid
        gid = grp.getgrnam(group).gr_gid if sep and group else pwd.getpwnam(user).pw_gid
    except KeyError as exc:
        sys.stderr.write("ERROR: unknown owner %r for parent chown: %s\n" % (owner, exc))
        sys.exit(1)
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
    local token_parent
    token_parent="$(dirname "$token_file")"
    if [[ ! -d "$token_parent" ]]; then
        # Fresh parent: private to the service account (hub DB etc. live under
        # HAPI_HOME). Do not chmod an existing mount/dir - only create new.
        mkdir -m 0700 -p "$token_parent"
    fi
    if [[ -n "$owner" && "$scope" == system ]]; then
        # Fail closed if we cannot make the parent writable by the runner user -
        # otherwise the printed setup steps cannot create the token file.
        hapi_claude_oauth_secure_chown_parent "$token_parent" "$owner" || return 1
    fi

    # One-time estate migrate hint (antevorta hotfix under .hapi/) - never keep
    # dual drop-in paths in the installer.
    if [[ "$(basename "$token_file")" == "claude-setup-token.env" ]]; then
        local legacy_token="${token_parent}/.hapi/claude-setup-token.env"
        if [[ -f "$legacy_token" && ! -f "$token_file" ]]; then
            echo "WARN: legacy token at $legacy_token - migrate once to canonical path:" >&2
            echo "       cp -a $(printf '%q' "$legacy_token") $(printf '%q' "$token_file") && chmod 600 $(printf '%q' "$token_file")" >&2
            echo "       then: systemctl restart ${runner_unit}" >&2
        fi
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
            # daemon-reload alone does not reload EnvironmentFile into a live
            # process — operator must restart the runner to pick up the token.
            local restart_cmd
            case "$scope" in
                user) restart_cmd="systemctl --user restart ${runner_unit}" ;;
                *)    restart_cmd="systemctl restart ${runner_unit}" ;;
            esac
            cat <<EOF
==> If the runner is already running, reload it so new UI sessions inherit the token:
      $restart_cmd
    (daemon-reload alone does not update the running process environment.)
EOF
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
