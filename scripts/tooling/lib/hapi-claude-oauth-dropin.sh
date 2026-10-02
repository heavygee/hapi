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
#       --token-file /etc/hapi/claude-setup-token.env \
#       [--owner hapi:hapi]   # only for non-/etc paths; ignored under /etc/
#
# Idempotent. Does not mint Anthropic tokens. If the env file is missing, prints
# a clear one-time setup instruction and still installs the drop-in (systemd's
# EnvironmentFile=- form ignores a missing file so the unit still starts).

# System-scope fleet: root-controlled path. systemd reads EnvironmentFile as root
# before dropping to User=; the service account must NOT be able to replace this
# file with a symlink to other root-readable secrets (Codex P1).
hapi_claude_oauth_system_token_file() {
    printf '%s' "/etc/hapi/claude-setup-token.env"
}

# User-scope / pet: token lives next to HAPI_HOME (operator-owned tree).
hapi_claude_oauth_default_token_file() {
    local hapi_home="${1:?hapi_home}"
    printf '%s' "$hapi_home/claude-setup-token.env"
}

hapi_print_claude_oauth_setup_instructions() {
    local token_file="${1:?token_file}"
    local runner_unit="${2:-hapi-runner.service}"
    local scope="${3:-system}"
    local restart_cmd
    case "$scope" in
        user) restart_cmd="systemctl --user restart ${runner_unit}" ;;
        *)    restart_cmd="sudo systemctl restart ${runner_unit}" ;;
    esac
    if [[ "$scope" == system ]]; then
        cat <<EOF

==> Claude OAuth for runner-spawned sessions is NOT configured yet.
    New UI / machine-spawn Claude sessions will print:
      Not logged in · Please run /login
    Existing --resume sessions can keep working and hide this gap.

    One-time setup (privileged write - file stays root:root 0600 under /etc):
      claude setup-token
      sudo install -d -m 0755 "$(dirname "$token_file")"
      printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' | sudo tee '$token_file' >/dev/null
      sudo chmod 600 '$token_file'
    And reload the runner:
      $restart_cmd

    Drop-in already points at: $token_file
EOF
    else
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
    fi
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

# Copy src → dst without preserving symlinks. Opens src with O_NOFOLLOW, writes a
# brand-new regular file at dst (O_CREAT|O_EXCL|O_NOFOLLOW on a temp, then rename).
# Never use `cp -a` for legacy migrate — that re-creates attacker symlinks under /etc.
hapi_claude_oauth_secure_copy_regular_file() {
    local src="${1:?src}"
    local dst="${2:?dst}"
    if ! command -v python3 >/dev/null 2>&1; then
        echo "ERROR: python3 required for secure token copy ($src -> $dst)" >&2
        return 1
    fi
    python3 - "$src" "$dst" <<'PY'
import os, stat, sys

src, dst = sys.argv[1], sys.argv[2]
rd_flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    rd_flags |= os.O_NOFOLLOW
if hasattr(os, "O_NONBLOCK"):
    rd_flags |= os.O_NONBLOCK
try:
    sfd = os.open(src, rd_flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open source token without following symlink: %s: %s\n" % (src, exc))
    sys.exit(1)
try:
    mode = os.fstat(sfd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular source token: %s\n" % src)
        sys.exit(1)
    data = b""
    while True:
        chunk = os.read(sfd, 65536)
        if not chunk:
            break
        data += chunk
finally:
    os.close(sfd)

parent = os.path.dirname(dst) or "."
os.makedirs(parent, mode=0o755, exist_ok=True)
tmp = dst + ".tmp.%d" % os.getpid()
try:
    if os.path.lexists(tmp):
        os.unlink(tmp)
except OSError:
    pass
wr_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
if hasattr(os, "O_NOFOLLOW"):
    wr_flags |= os.O_NOFOLLOW
try:
    dfd = os.open(tmp, wr_flags, 0o600)
except OSError as exc:
    sys.stderr.write("ERROR: cannot create destination token: %s: %s\n" % (tmp, exc))
    sys.exit(1)
try:
    os.write(dfd, data)
    os.fchmod(dfd, 0o600)
finally:
    os.close(dfd)
os.replace(tmp, dst)
sys.exit(0)
PY
}

# Known pre-/etc locations (fleet service home + primary-soup operator hand-install).
hapi_claude_oauth_legacy_system_token_candidates() {
    printf '%s\n' \
        /var/lib/hapi/claude-setup-token.env \
        /var/lib/hapi/.hapi/claude-setup-token.env \
        /home/heavygee/.hapi/claude-setup-token.env
    if [[ -n "${HOME:-}" && "$HOME" != /home/heavygee ]]; then
        printf '%s\n' "${HOME}/.hapi/claude-setup-token.env"
    fi
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
    local token_parent root_controlled=0
    token_parent="$(dirname "$token_file")"
    # /etc/hapi/... stays root-controlled - never chown to the service account.
    if [[ "$scope" == system && "$token_file" == /etc/* ]]; then
        root_controlled=1
    fi
    if [[ ! -d "$token_parent" ]]; then
        if [[ "$root_controlled" -eq 1 ]]; then
            # Root-owned config dir (matches /etc/hapi sentinel layout).
            mkdir -m 0755 -p "$token_parent"
        else
            # User/pet HAPI_HOME parent: private when freshly created.
            mkdir -m 0700 -p "$token_parent"
        fi
    fi
    if [[ -n "$owner" && "$scope" == system && "$root_controlled" -eq 0 ]]; then
        # Legacy non-/etc system paths only. Fail closed so setup can write.
        hapi_claude_oauth_secure_chown_parent "$token_parent" "$owner" || return 1
    elif [[ -n "$owner" && "$root_controlled" -eq 1 ]]; then
        echo "NOTE: ignoring --owner=$owner for root-controlled token path $token_file" >&2
    fi

    # Migrate: service-home / operator .hapi/ -> /etc/hapi (system) or pet canonical.
    # Exported for callers that must fail closed before --restart.
    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=0
    if [[ "$(basename "$token_file")" == "claude-setup-token.env" && ! -f "$token_file" ]]; then
        local legacy_token
        if [[ "$root_controlled" -eq 1 ]]; then
            while IFS= read -r legacy_token; do
                [[ -n "$legacy_token" ]] || continue
                [[ -e "$legacy_token" || -L "$legacy_token" ]] || continue
                if [[ -L "$legacy_token" ]]; then
                    echo "ERROR: refusing to migrate symlink legacy token: $legacy_token" >&2
                    echo "       Replace with a regular file, then re-run install (never sudo cp -a)." >&2
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                    break
                fi
                if hapi_claude_oauth_secure_copy_regular_file "$legacy_token" "$token_file"; then
                    echo "Migrated Claude OAuth token: $legacy_token -> $token_file (regular file, 0600)"
                    break
                fi
                echo "WARN: could not migrate legacy token at $legacy_token" >&2
                HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                echo "       Fix the source (must be a regular file), then:" >&2
                echo "       source scripts/tooling/lib/hapi-claude-oauth-dropin.sh" >&2
                echo "       hapi_claude_oauth_secure_copy_regular_file $(printf '%q' "$legacy_token") $(printf '%q' "$token_file")" >&2
                echo "       then: sudo systemctl restart ${runner_unit}" >&2
                break
            done < <(hapi_claude_oauth_legacy_system_token_candidates)
            if [[ ! -f "$token_file" ]]; then
                # Still missing: if any legacy path exists we owe a migrate before restart.
                while IFS= read -r legacy_token; do
                    if [[ -e "$legacy_token" || -L "$legacy_token" ]]; then
                        HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                        break
                    fi
                done < <(hapi_claude_oauth_legacy_system_token_candidates)
            fi
        else
            legacy_token="${token_parent}/.hapi/claude-setup-token.env"
            if [[ -e "$legacy_token" || -L "$legacy_token" ]]; then
                if [[ -L "$legacy_token" ]]; then
                    echo "ERROR: refusing to migrate symlink legacy token: $legacy_token" >&2
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                elif hapi_claude_oauth_secure_copy_regular_file "$legacy_token" "$token_file"; then
                    echo "Migrated Claude OAuth token: $legacy_token -> $token_file"
                else
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                    echo "WARN: could not migrate legacy token at $legacy_token" >&2
                fi
            fi
        fi
    fi
    export HAPI_CLAUDE_OAUTH_MIGRATE_PENDING

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
        if [[ "$root_controlled" -eq 1 ]]; then
            # Keep root:root 0600 - never hand the file to the service UID.
            hapi_claude_oauth_secure_chmod_chown "$token_file" || return 1
        elif [[ -n "$owner" && "$scope" == system ]]; then
            hapi_claude_oauth_secure_chmod_chown "$token_file" "$owner" || return 1
        else
            hapi_claude_oauth_secure_chmod_chown "$token_file" || return 1
        fi
        # Non-whitespace value only — CLAUDE_CODE_OAUTH_TOKEN=\r\n is unconfigured
        # (grep '.' treats CR as a value; systemd would load an empty credential).
        if grep -q $'^CLAUDE_CODE_OAUTH_TOKEN=[^[:space:]]' "$token_file" 2>/dev/null; then
            echo "Claude OAuth token file present: $token_file"
            # daemon-reload alone does not reload EnvironmentFile into a live
            # process — operator must restart the runner to pick up the token.
            local restart_cmd
            case "$scope" in
                user) restart_cmd="systemctl --user restart ${runner_unit}" ;;
                *)    restart_cmd="sudo systemctl restart ${runner_unit}" ;;
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
