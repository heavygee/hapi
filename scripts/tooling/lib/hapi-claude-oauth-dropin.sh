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
      printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' \\
        | sudo install -m 0600 /dev/stdin '$token_file'
    And reload the runner:
      $restart_cmd

    Drop-in already points at: $token_file
    Prerequisite: python3 on PATH (system install uses it for O_NOFOLLOW migrate/chmod).
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
    if [[ -L "$src" ]]; then
        echo "ERROR: refusing to copy symlink source token: $src" >&2
        return 1
    fi
    if [[ ! -f "$src" ]]; then
        echo "ERROR: source token is not a regular file: $src" >&2
        return 1
    fi
    if command -v python3 >/dev/null 2>&1; then
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
        return $?
    fi

    # Bash fallback for same-user pet hosts without python3. Never for /etc
    # (system migrate requires python3 for O_NOFOLLOW root writes).
    case "$dst" in
        /etc/*)
            echo "ERROR: python3 required for secure token copy into /etc ($src -> $dst)" >&2
            return 1
            ;;
    esac
    if [[ -L "$dst" ]]; then
        echo "ERROR: refusing to overwrite symlink destination: $dst" >&2
        return 1
    fi
    local parent tmp
    parent="${dst%/*}"
    if [[ -z "$parent" || "$parent" == "$dst" ]]; then
        parent="."
    fi
    # Absolute coreutils: pet PATH may omit /usr/bin while still lacking python3.
    /bin/mkdir -p "$parent" || return 1
    tmp="$(/usr/bin/mktemp "${parent}/.claude-oauth-copy.XXXXXX")" || return 1
    if ! /bin/cp -f -- "$src" "$tmp"; then
        /bin/rm -f -- "$tmp"
        return 1
    fi
    if [[ -L "$tmp" ]]; then
        /bin/rm -f -- "$tmp"
        echo "ERROR: temp copy became a symlink: $tmp" >&2
        return 1
    fi
    /bin/chmod 600 "$tmp" || { /bin/rm -f -- "$tmp"; return 1; }
    if ! /bin/mv -f -- "$tmp" "$dst"; then
        /bin/rm -f -- "$tmp"
        return 1
    fi
    return 0
}

# After a verified migrate, archive the legacy source so a later empty/missing
# canonical cannot silently re-import a revoked credential on reinstall.
hapi_claude_oauth_retire_legacy_token_source() {
    local src="${1:?src}"
    if [[ -L "$src" ]]; then
        echo "ERROR: refusing to retire symlink legacy token: $src" >&2
        return 1
    fi
    if [[ ! -f "$src" ]]; then
        return 0
    fi
    local dest="${src}.migrated.$(date +%s)"
    if command -v python3 >/dev/null 2>&1; then
        # Explicit status check: callers may invoke us under `cmd || warn`, which
        # suppresses errexit so a failed rename must not fall through to success.
        if ! python3 - "$src" "$dest" <<'PY'
import os, stat, sys
src, dest = sys.argv[1], sys.argv[2]
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(src, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open legacy token to retire: %s: %s\n" % (src, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular legacy token: %s\n" % src)
        sys.exit(1)
finally:
    os.close(fd)
if os.path.lexists(dest):
    sys.stderr.write("ERROR: retire destination already exists: %s\n" % dest)
    sys.exit(1)
os.rename(src, dest)
sys.exit(0)
PY
        then
            return 1
        fi
    else
        # Pet / minimal hosts: already refused symlinks; mv is enough.
        mv -n -- "$src" "$dest" || return 1
    fi
    echo "Retired legacy Claude OAuth token: $src -> $dest"
    return 0
}

# Unlink a regular file without following a final-component symlink.
# Used to roll back a newly created canonical token when no backup exists.
hapi_claude_oauth_secure_unlink_regular_file() {
    local path="${1:?path}"
    if [[ -L "$path" ]]; then
        echo "ERROR: refusing to unlink symlink token: $path" >&2
        return 1
    fi
    if [[ ! -e "$path" ]]; then
        return 0
    fi
    if [[ ! -f "$path" ]]; then
        echo "ERROR: refusing to unlink non-regular token: $path" >&2
        return 1
    fi
    python3 - "$path" <<'PY'
import os, stat, sys
path = sys.argv[1]
flags = 0
if hasattr(os, "O_PATH"):
    flags |= os.O_PATH
elif hasattr(os, "O_RDONLY"):
    flags |= os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open token to unlink: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular token unlink: %s\n" % path)
        sys.exit(1)
finally:
    os.close(fd)
try:
    os.unlink(path)
except OSError as exc:
    sys.stderr.write("ERROR: cannot unlink token %s: %s\n" % (path, exc))
    sys.exit(1)
sys.exit(0)
PY
}

# Privileged unlink: absolute python3 + sanitized env (same constraints as install).
hapi_claude_oauth_secure_unlink_regular_file_via_sudo() {
    local path="${1:?path}"
    local py
    py="$(hapi_claude_oauth_absolute_python3)" || {
        echo "ERROR: absolute python3 required for privileged token unlink" >&2
        return 1
    }
    sudo /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C "$py" - "$path" <<'PY'
import os, stat, sys
path = sys.argv[1]
if os.path.islink(path):
    sys.stderr.write("ERROR: refusing to unlink symlink token: %s\n" % path)
    sys.exit(1)
if not os.path.exists(path):
    sys.exit(0)
flags = 0
if hasattr(os, "O_PATH"):
    flags |= os.O_PATH
elif hasattr(os, "O_RDONLY"):
    flags |= os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open token to unlink: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular token unlink: %s\n" % path)
        sys.exit(1)
finally:
    os.close(fd)
try:
    os.unlink(path)
except OSError as exc:
    sys.stderr.write("ERROR: cannot unlink token %s: %s\n" % (path, exc))
    sys.exit(1)
sys.exit(0)
PY
}

# Emit src bytes to stdout (O_NOFOLLOW). Used so privileged writers consume an
# already-opened pipe instead of reopening a mutable pathname as root.
hapi_claude_oauth_cat_regular_file() {
    local src="${1:?src}"
    python3 - "$src" <<'PY'
import os, stat, sys
path = sys.argv[1]
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
if hasattr(os, "O_NONBLOCK"):
    flags |= os.O_NONBLOCK
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open token without following symlink: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular token: %s\n" % path)
        sys.exit(1)
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
finally:
    os.close(fd)
sys.exit(0)
PY
}

# Python program for install_bytes (shared by unprivileged + sudo paths).
# Kept as a function so privileged install never re-sources this checkout.
_hapi_claude_oauth_install_bytes_py() {
    cat <<'PY'
import os, sys
dst = sys.argv[1]
data = sys.stdin.buffer.read()
if not data:
    sys.stderr.write("ERROR: empty token payload; refusing to replace %s\n" % dst)
    sys.exit(1)

def parse_value(raw):
    val = raw.strip()
    if not val:
        return None
    if len(val) >= 2 and val[0:1] == val[-1:] and val[0:1] in (b"\x27", b"\x22"):
        val = val[1:-1]
    val = val.strip()
    return val if val else None

last = None
for line in data.splitlines():
    if line.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
        last = parse_value(line.split(b"=", 1)[1])
if last is None:
    sys.stderr.write(
        "ERROR: piped payload has no nonempty CLAUDE_CODE_OAUTH_TOKEN=; "
        "refusing to replace %s\n" % dst
    )
    sys.exit(1)

parent = os.path.dirname(dst) or "."
os.makedirs(parent, mode=0o755, exist_ok=True)
tmp = dst + ".tmp.%d" % os.getpid()
try:
    if os.path.lexists(tmp):
        os.unlink(tmp)
except OSError:
    pass
flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(tmp, flags, 0o600)
except OSError as exc:
    sys.stderr.write("ERROR: cannot create destination token: %s: %s\n" % (tmp, exc))
    sys.exit(1)
try:
    os.write(fd, data)
    os.fchmod(fd, 0o600)
finally:
    os.close(fd)
os.replace(tmp, dst)
sys.exit(0)
PY
}

# Absolute python3 for privileged paths (never PATH-resolve under sudo).
hapi_claude_oauth_absolute_python3() {
    local cand
    for cand in /usr/bin/python3 /bin/python3; do
        if [[ -x "$cand" ]]; then
            printf '%s' "$cand"
            return 0
        fi
    done
    return 1
}

# Install stdin bytes at dst (temp + os.replace, 0600). Reads already-opened
# stdin so a privileged caller never reopens a user-controlled source path.
# Uses python3 -c (not /dev/fd/N) so `sudo` can close fds >= 3 and still work.
# Refuses empty / ineffective payloads before os.replace so a failed producer
# cannot wipe a valid destination.
hapi_claude_oauth_install_bytes() {
    local dst="${1:?dst}"
    local prog
    prog="$(_hapi_claude_oauth_install_bytes_py)"
    python3 -c "$prog" "$dst"
}

# Privileged install: absolute python3 + sanitized env. Never PATH-resolve bash
# and never source the operator-writable checkout as root.
hapi_claude_oauth_install_bytes_via_sudo() {
    local dst="${1:?dst}"
    local py prog
    py="$(hapi_claude_oauth_absolute_python3)" || {
        echo "ERROR: absolute python3 (/usr/bin/python3 or /bin/python3) required for privileged token install" >&2
        return 1
    }
    prog="$(_hapi_claude_oauth_install_bytes_py)"
    # stdin (token bytes) is preserved across sudo; env is scrubbed.
    sudo /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C "$py" -c "$prog" "$dst"
}

# Restore stdin bytes at dst without requiring a nonempty OAuth assignment.
# Used for toggle rollback of empty/ineffective prior canonical files.
_hapi_claude_oauth_restore_bytes_py() {
    cat <<'PY'
import os, sys
dst = sys.argv[1]
data = sys.stdin.buffer.read()
parent = os.path.dirname(dst) or "."
os.makedirs(parent, mode=0o755, exist_ok=True)
tmp = dst + ".tmp.%d" % os.getpid()
try:
    if os.path.lexists(tmp):
        os.unlink(tmp)
except OSError:
    pass
flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(tmp, flags, 0o600)
except OSError as exc:
    sys.stderr.write("ERROR: cannot create restore destination: %s: %s\n" % (tmp, exc))
    sys.exit(1)
try:
    if data:
        os.write(fd, data)
    os.fchmod(fd, 0o600)
finally:
    os.close(fd)
os.replace(tmp, dst)
sys.exit(0)
PY
}

hapi_claude_oauth_restore_bytes() {
    local dst="${1:?dst}"
    local prog
    prog="$(_hapi_claude_oauth_restore_bytes_py)"
    python3 -c "$prog" "$dst"
}

hapi_claude_oauth_restore_bytes_via_sudo() {
    local dst="${1:?dst}"
    local py prog
    py="$(hapi_claude_oauth_absolute_python3)" || {
        echo "ERROR: absolute python3 required for privileged token restore" >&2
        return 1
    }
    prog="$(_hapi_claude_oauth_restore_bytes_py)"
    sudo /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C "$py" -c "$prog" "$dst"
}

# Known pre-/etc locations, scoped by install profile so fleet cannot silently
# import the primary-soup operator token (and vice versa). Optional second arg is
# the configured HAPI_HOME (fleet --hapi-home). Optional third is the selected
# operator home (primary-soup OOS_OPERATOR_HOME) — never the sudoer's HOME=/root.
hapi_claude_oauth_legacy_system_token_candidates() {
    local profile="${1:-}"
    local hapi_home="${2:-}"
    local operator_home="${3:-}"
    local -a paths=()
    case "$profile" in
        fleet-binary|fleet)
            paths=(
                /var/lib/hapi/claude-setup-token.env
                /var/lib/hapi/.hapi/claude-setup-token.env
            )
            if [[ -n "$hapi_home" && "$hapi_home" != /var/lib/hapi ]]; then
                paths+=(
                    "$hapi_home/claude-setup-token.env"
                    "$hapi_home/.hapi/claude-setup-token.env"
                )
            fi
            ;;
        primary-soup|soup)
            local soup_op="${operator_home:-/home/heavygee}"
            paths=("${soup_op}/.hapi/claude-setup-token.env")
            # Soup HAPI_HOME defaults to /var/lib/hapi (fleet service home). Never
            # treat that default as a soup migrate source — only a genuinely
            # custom soup home (distinct from operator home AND fleet default).
            if [[ -n "$hapi_home" \
                && "$hapi_home" != /var/lib/hapi \
                && "$hapi_home" != "${soup_op}/.hapi" \
                && "$hapi_home" != "$soup_op" ]]; then
                paths+=(
                    "$hapi_home/claude-setup-token.env"
                    "$hapi_home/.hapi/claude-setup-token.env"
                )
            fi
            ;;
        ""|*)
            # No profile: emit both classes. Caller must fail closed on ambiguity.
            paths=(
                /var/lib/hapi/claude-setup-token.env
                /var/lib/hapi/.hapi/claude-setup-token.env
                "${operator_home:-/home/heavygee}/.hapi/claude-setup-token.env"
            )
            if [[ -n "$hapi_home" ]]; then
                paths+=(
                    "$hapi_home/claude-setup-token.env"
                    "$hapi_home/.hapi/claude-setup-token.env"
                )
            fi
            ;;
    esac
    # De-dupe while preserving order (custom home may equal a default).
    local p seen=$'\n'
    for p in "${paths[@]}"; do
        [[ -n "$p" ]] || continue
        if [[ "$seen" != *$'\n'"$p"$'\n'* ]]; then
            printf '%s\n' "$p"
            seen+="$p"$'\n'
        fi
    done
}

# Mirror systemd EnvironmentFile value parsing (systemd.exec(5) / env-file.c):
# strip outer whitespace; single-quoted = literal; double-quoted unescapes
# \, ", `, $; unquoted backslash escapes the next character.
hapi_claude_oauth_parse_env_file_value() {
    local raw="${1-}"
    raw="${raw%$'\r'}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    [[ -n "$raw" ]] || return 1

    local quote=""
    if [[ ${#raw} -ge 2 ]]; then
        if [[ "${raw:0:1}" == '"' && "${raw: -1}" == '"' ]]; then
            quote=double
            raw="${raw:1:${#raw}-2}"
        elif [[ "${raw:0:1}" == "'" && "${raw: -1}" == "'" ]]; then
            printf '%s' "${raw:1:${#raw}-2}"
            return 0
        fi
    fi

    local out="" i=0 c nxt
    if [[ "$quote" == "double" ]]; then
        while (( i < ${#raw} )); do
            c="${raw:i:1}"
            if [[ "$c" == '\' && $((i + 1)) -lt ${#raw} ]]; then
                nxt="${raw:i+1:1}"
                case "$nxt" in
                    '\\'|'"'|'`'|'$') out+="$nxt" ;;
                    *) out+="\\$nxt" ;;
                esac
                i=$((i + 2))
                continue
            fi
            out+="$c"
            i=$((i + 1))
        done
        [[ -n "$out" ]] || return 1
        printf '%s' "$out"
        return 0
    fi

    # Unquoted: \X → X (including \\ → \).
    while (( i < ${#raw} )); do
        c="${raw:i:1}"
        if [[ "$c" == '\' && $((i + 1)) -lt ${#raw} ]]; then
            out+="${raw:i+1:1}"
            i=$((i + 2))
            continue
        fi
        out+="$c"
        i=$((i + 1))
    done
    [[ -n "$out" ]] || return 1
    printf '%s' "$out"
    return 0
}

# Last effective CLAUDE_CODE_OAUTH_TOKEN= value (systemd last-assignment-wins),
# after systemd-compatible unquote/unescape. Empty / whitespace-only → unset (exit 2).
hapi_claude_oauth_effective_token_value() {
    local token_file="${1:?token_file}"
    if [[ -L "$token_file" ]]; then
        echo "ERROR: refusing symlink token file: $token_file" >&2
        return 1
    fi
    if [[ ! -f "$token_file" ]]; then
        return 1
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$token_file" <<'PY'
import os, stat, sys

path = sys.argv[1]
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
if hasattr(os, "O_NONBLOCK"):
    flags |= os.O_NONBLOCK
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open token file: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    mode = os.fstat(fd).st_mode
    if not stat.S_ISREG(mode):
        sys.stderr.write("ERROR: refusing non-regular token file: %s\n" % path)
        sys.exit(1)
    data = b""
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        data += chunk
finally:
    os.close(fd)

def parse_value(raw):
    # Mirror verify-hapi-install.sh parse_env_file_value / systemd env-file.c.
    if raw is None:
        return None
    val = raw.strip()
    if not val:
        return None
    if len(val) >= 2 and val[0:1] == val[-1:] == b"'":
        return val[1:-1] or None
    if len(val) >= 2 and val[0:1] == val[-1:] == b'"':
        inner = val[1:-1]
        out = bytearray()
        i = 0
        while i < len(inner):
            if inner[i:i+1] == b"\\" and i + 1 < len(inner):
                nxt = inner[i+1:i+2]
                if nxt in (b"\\", b'"', b"`", b"$"):
                    out.extend(nxt)
                else:
                    out.extend(b"\\")
                    out.extend(nxt)
                i += 2
                continue
            out.extend(inner[i:i+1])
            i += 1
        return bytes(out) or None
    out = bytearray()
    i = 0
    while i < len(val):
        if val[i:i+1] == b"\\" and i + 1 < len(val):
            out.extend(val[i+1:i+2])
            i += 2
            continue
        out.extend(val[i:i+1])
        i += 1
    return bytes(out) or None

last = None
for line in data.splitlines():
    if line.startswith(b"CLAUDE_CODE_OAUTH_TOKEN="):
        last = parse_value(line.split(b"=", 1)[1])
if last is None:
    sys.exit(2)
sys.stdout.buffer.write(last)
sys.exit(0)
PY
        return $?
    fi

    # Bash fallback (pet / minimal hosts without python3).
    local line raw last=""
    while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in
            CLAUDE_CODE_OAUTH_TOKEN=*)
                raw="${line#CLAUDE_CODE_OAUTH_TOKEN=}"
                if parsed="$(hapi_claude_oauth_parse_env_file_value "$raw")"; then
                    last="$parsed"
                else
                    last=""
                fi
                ;;
        esac
    done <"$token_file"
    if [[ -z "$last" ]]; then
        return 2
    fi
    printf '%s' "$last"
    return 0
}

# True when the final EnvironmentFile assignment is a nonempty token.
hapi_claude_oauth_has_effective_token() {
    local token_file="${1:?token_file}"
    local eff=""
    set +e
    eff="$(hapi_claude_oauth_effective_token_value "$token_file" 2>/dev/null)"
    local rc=$?
    set -e
    [[ "$rc" -eq 0 && -n "$eff" ]]
}

# chown + chmod without following a symlink final component (drop-in is 0644).
hapi_claude_oauth_secure_chown_mode() {
    local path="${1:?path}"
    local owner="${2:?owner}"
    local mode="${3:?mode}"
    if [[ -L "$path" ]]; then
        echo "ERROR: refusing symlink: $path" >&2
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "ERROR: python3 required to securely chown/chmod $path" >&2
        return 1
    fi
    python3 - "$path" "$owner" "$mode" <<'PY'
import grp, os, pwd, stat, sys
path, owner, mode_s = sys.argv[1], sys.argv[2], sys.argv[3]
flags = os.O_RDONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
if hasattr(os, "O_NONBLOCK"):
    flags |= os.O_NONBLOCK
try:
    fd = os.open(path, flags)
except OSError as exc:
    sys.stderr.write("ERROR: cannot open without following symlink: %s: %s\n" % (path, exc))
    sys.exit(1)
try:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        sys.stderr.write("ERROR: refusing non-regular file: %s\n" % path)
        sys.exit(1)
    user, sep, group = owner.partition(":")
    try:
        uid = pwd.getpwnam(user).pw_uid
        gid = grp.getgrnam(group).gr_gid if sep and group else pwd.getpwnam(user).pw_gid
    except KeyError as exc:
        sys.stderr.write("ERROR: unknown owner %r: %s\n" % (owner, exc))
        sys.exit(1)
    os.fchown(fd, uid, gid)
    os.fchmod(fd, int(mode_s, 8))
finally:
    os.close(fd)
sys.exit(0)
PY
}

# Write stdin to dst as a brand-new regular file (O_CREAT|O_EXCL|O_NOFOLLOW on the
# final path). Never follows a pre-planted symlink at dst — used for operator-owned
# backups of root-read tokens (privileged process must not write into auth-bak).
# Program is on fd 3 so caller stdin (piped token bytes) stays available.
hapi_claude_oauth_secure_write_new_file() {
    local dst="${1:?dst}"
    python3 /dev/fd/3 "$dst" 3<<'PY'
import os, sys

dst = sys.argv[1]
parent = os.path.dirname(dst) or "."
os.makedirs(parent, mode=0o700, exist_ok=True)
data = sys.stdin.buffer.read()
# POSIX: O_CREAT|O_EXCL fails if dst exists OR is a dangling/present symlink —
# privileged apps writing into user-writable dirs must use this, not check-then-create.
flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    fd = os.open(dst, flags, 0o600)
except OSError as exc:
    sys.stderr.write("ERROR: cannot create exclusive backup file: %s: %s\n" % (dst, exc))
    sys.exit(1)
try:
    os.write(fd, data)
    os.fchmod(fd, 0o600)
finally:
    os.close(fd)
sys.exit(0)
PY
}

# Assert /etc/... token parent is root-owned and not group/other-writable.
# Prefer python3 lstat; bash `stat -c` fallback when python3 is absent (preflight
# should still require python3 for system migrate/chmod before units change).
hapi_claude_oauth_assert_root_controlled_parent() {
    local parent_dir="${1:?parent_dir}"
    if [[ -L "$parent_dir" ]]; then
        echo "ERROR: token parent is a symlink: $parent_dir" >&2
        return 1
    fi
    if [[ ! -d "$parent_dir" ]]; then
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$parent_dir" <<'PY'
import os, stat, sys
path = sys.argv[1]
st = os.lstat(path)
if stat.S_ISLNK(st.st_mode):
    sys.stderr.write("ERROR: token parent is a symlink: %s\n" % path)
    sys.exit(1)
if not stat.S_ISDIR(st.st_mode):
    sys.stderr.write("ERROR: token parent is not a directory: %s\n" % path)
    sys.exit(1)
if st.st_uid != 0:
    sys.stderr.write(
        "ERROR: token parent %s is owned by uid %d (must be root) — "
        "service-writable /etc/hapi defeats EnvironmentFile root-control\n"
        % (path, st.st_uid)
    )
    sys.exit(1)
if st.st_mode & 0o022:
    sys.stderr.write(
        "ERROR: token parent %s is group/other-writable (mode %04o) — "
        "fix ownership/mode before installing the OAuth drop-in\n"
        % (path, stat.S_IMODE(st.st_mode))
    )
    sys.exit(1)
sys.exit(0)
PY
        return $?
    fi
    local uid mode
    uid="$(stat -c '%u' "$parent_dir" 2>/dev/null || true)"
    mode="$(stat -c '%a' "$parent_dir" 2>/dev/null || true)"
    if [[ -z "$uid" || -z "$mode" ]]; then
        echo "ERROR: cannot stat token parent $parent_dir (need python3 or GNU stat)" >&2
        return 1
    fi
    if [[ "$uid" != 0 ]]; then
        echo "ERROR: token parent $parent_dir is owned by uid $uid (must be root) — service-writable /etc/hapi defeats EnvironmentFile root-control" >&2
        return 1
    fi
    # mode is octal like 755; reject group/other write (022).
    if (( (8#$mode & 8#022) != 0 )); then
        echo "ERROR: token parent $parent_dir is group/other-writable (mode $mode) — fix ownership/mode before installing the OAuth drop-in" >&2
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
    local scope="" runner_unit="" token_file="" owner="" migrate_profile="" migrate_hapi_home="" migrate_operator_home=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --scope) scope="${2:?}"; shift 2 ;;
            --runner-unit) runner_unit="${2:?}"; shift 2 ;;
            --token-file) token_file="${2:?}"; shift 2 ;;
            --owner) owner="${2:?}"; shift 2 ;;
            --migrate-profile) migrate_profile="${2:?}"; shift 2 ;;
            --migrate-hapi-home) migrate_hapi_home="${2:?}"; shift 2 ;;
            --migrate-operator-home) migrate_operator_home="${2:?}"; shift 2 ;;
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

    # Parent of the token file (may not exist yet on a fresh box).
    local token_parent root_controlled=0
    token_parent="$(dirname "$token_file")"
    # /etc/hapi/... stays root-controlled - never chown to the service account.
    if [[ "$scope" == system && "$token_file" == /etc/* ]]; then
        root_controlled=1
    fi

    # System drop-in dir must be root-owned and not service-writable before we write.
    # Explicit || return 1: callers may wrap us in `set +e` to capture status.
    if [[ "$scope" == system ]]; then
        if [[ ! -d "$dropin_dir" ]]; then
            if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
                echo "ERROR: creating $dropin_dir requires root" >&2
                return 1
            fi
            mkdir -m 0755 -p "$dropin_dir" || return 1
        fi
        hapi_claude_oauth_assert_root_controlled_parent "$dropin_dir" || return 1
    else
        mkdir -p "$dropin_dir" || return 1
    fi

    if [[ ! -d "$token_parent" ]]; then
        if [[ "$root_controlled" -eq 1 ]]; then
            mkdir -m 0755 -p "$token_parent" || return 1
            if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
                echo "ERROR: creating $token_parent requires root (got euid=${EUID:-$(id -u)})" >&2
                return 1
            fi
        else
            mkdir -m 0700 -p "$token_parent" || return 1
        fi
    fi
    if [[ "$root_controlled" -eq 1 ]]; then
        hapi_claude_oauth_assert_root_controlled_parent "$token_parent" || return 1
    fi
    if [[ -n "$owner" && "$scope" == system && "$root_controlled" -eq 0 ]]; then
        hapi_claude_oauth_secure_chown_parent "$token_parent" "$owner" || return 1
    elif [[ -n "$owner" && "$root_controlled" -eq 1 ]]; then
        echo "NOTE: ignoring --owner=$owner for root-controlled token path $token_file" >&2
    fi

    # Migrate when canonical is missing OR exists but has no effective token while
    # a legacy credential is still present (empty-file trap).
    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=0
    local need_migrate=0
    if [[ "$(basename "$token_file")" == "claude-setup-token.env" ]]; then
        if [[ ! -f "$token_file" ]]; then
            need_migrate=1
        elif ! hapi_claude_oauth_has_effective_token "$token_file"; then
            need_migrate=1
        fi
    fi
    if [[ "$need_migrate" -eq 1 ]]; then
        local legacy_token
        if [[ "$root_controlled" -eq 1 ]]; then
            local -a present=()
            while IFS= read -r legacy_token; do
                [[ -n "$legacy_token" ]] || continue
                [[ "$legacy_token" == "$token_file" ]] && continue
                if [[ -e "$legacy_token" || -L "$legacy_token" ]]; then
                    present+=("$legacy_token")
                fi
            done < <(hapi_claude_oauth_legacy_system_token_candidates "$migrate_profile" "$migrate_hapi_home" "$migrate_operator_home")

            if [[ ${#present[@]} -gt 1 ]]; then
                echo "ERROR: multiple legacy Claude OAuth tokens for profile '${migrate_profile:-unset}'; refuse to guess" >&2
                printf '       - %s\n' "${present[@]}" >&2
                echo "       Pick one source, remove or rename the others, then re-run install." >&2
                HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
            elif [[ ${#present[@]} -eq 1 ]]; then
                legacy_token="${present[0]}"
                if [[ -L "$legacy_token" ]]; then
                    echo "ERROR: refusing to migrate symlink legacy token: $legacy_token" >&2
                    echo "       Replace with a regular file, then re-run install (never sudo cp -a)." >&2
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                elif hapi_claude_oauth_secure_copy_regular_file "$legacy_token" "$token_file"; then
                    echo "Migrated Claude OAuth token: $legacy_token -> $token_file (regular file, 0600)"
                    if hapi_claude_oauth_has_effective_token "$token_file" 2>/dev/null; then
                        hapi_claude_oauth_retire_legacy_token_source "$legacy_token" || {
                            echo "ERROR: migrated but could not retire legacy source $legacy_token" >&2
                            HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                        }
                    fi
                else
                    echo "WARN: could not migrate legacy token at $legacy_token" >&2
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                    echo "       Fix the source (must be a regular file), then:" >&2
                    echo "       source scripts/tooling/lib/hapi-claude-oauth-dropin.sh" >&2
                    echo "       hapi_claude_oauth_secure_copy_regular_file $(printf '%q' "$legacy_token") $(printf '%q' "$token_file")" >&2
                    echo "       then: sudo systemctl restart ${runner_unit}" >&2
                fi
            fi
            if [[ ${#present[@]} -gt 0 ]] && ! hapi_claude_oauth_has_effective_token "$token_file" 2>/dev/null; then
                HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
            fi
        else
            legacy_token="${token_parent}/.hapi/claude-setup-token.env"
            if [[ -e "$legacy_token" || -L "$legacy_token" ]]; then
                if [[ -L "$legacy_token" ]]; then
                    echo "ERROR: refusing to migrate symlink legacy token: $legacy_token" >&2
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                elif hapi_claude_oauth_secure_copy_regular_file "$legacy_token" "$token_file"; then
                    echo "Migrated Claude OAuth token: $legacy_token -> $token_file"
                    if hapi_claude_oauth_has_effective_token "$token_file" 2>/dev/null; then
                        hapi_claude_oauth_retire_legacy_token_source "$legacy_token" || {
                            echo "ERROR: migrated but could not retire legacy source $legacy_token" >&2
                            HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                        }
                    fi
                else
                    HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=1
                    echo "WARN: could not migrate legacy token at $legacy_token" >&2
                fi
            fi
        fi
    fi
    export HAPI_CLAUDE_OAUTH_MIGRATE_PENDING

    # Fail closed BEFORE installing the drop-in: pending migrate + new
    # EnvironmentFile at missing/empty /etc/hapi breaks the next restart.
    if [[ "${HAPI_CLAUDE_OAUTH_MIGRATE_PENDING:-0}" -eq 1 ]]; then
        echo "ERROR: Claude OAuth token migrate still pending; refusing to install drop-in for ${runner_unit}" >&2
        return 1
    fi

    # Reject a symlink/non-regular canonical path before persisting the drop-in.
    # systemd EnvironmentFile follows the symlink on later reload/reboot.
    if [[ -L "$token_file" ]]; then
        echo "ERROR: refusing symlink token file before drop-in: $token_file" >&2
        echo "       Replace with a regular root:root 0600 file, then re-run install." >&2
        return 1
    fi
    if [[ -e "$token_file" && ! -f "$token_file" ]]; then
        echo "ERROR: refusing non-regular token file before drop-in: $token_file" >&2
        return 1
    fi

    local dropin_tmp
    dropin_tmp="$(mktemp "${dropin_dir}/.42-claude-oauth-token.conf.XXXXXX")" || return 1
    if ! cat >"$dropin_tmp" <<EOF
# Installed by hapi_install_claude_oauth_dropin (scripts/tooling/lib/hapi-claude-oauth-dropin.sh).
# Leading '-' = ignore missing file so the unit still starts before the operator
# mints a setup-token. verify-hapi-install.sh fails the ambient-token check when
# live Claude children have a token and the runner does not.
[Service]
EnvironmentFile=-${token_file}
EOF
    then
        rm -f "$dropin_tmp"
        echo "ERROR: failed to write temporary drop-in $dropin_tmp" >&2
        return 1
    fi
    if [[ "$scope" == system ]]; then
        # Atomic install as root so a prior service-owned drop-in cannot retain owner.
        if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
            install -m 0644 -o root -g root "$dropin_tmp" "$dropin" || {
                rm -f "$dropin_tmp"
                echo "ERROR: failed to install drop-in $dropin" >&2
                return 1
            }
            rm -f "$dropin_tmp"
        else
            sudo install -m 0644 -o root -g root "$dropin_tmp" "$dropin" || {
                rm -f "$dropin_tmp"
                echo "ERROR: failed to install drop-in $dropin (sudo)" >&2
                return 1
            }
            rm -f "$dropin_tmp"
        fi
        hapi_claude_oauth_secure_chown_mode "$dropin" "root:root" "0644" || return 1
    else
        mv -f "$dropin_tmp" "$dropin" || {
            rm -f "$dropin_tmp"
            echo "ERROR: failed to install drop-in $dropin" >&2
            return 1
        }
        chmod 0644 "$dropin" || return 1
    fi
    echo "Installed: $dropin -> EnvironmentFile=-$token_file"

    if [[ -e "$token_file" || -L "$token_file" ]]; then
        hapi_claude_oauth_assert_safe_token_file "$token_file" || return 1
        if [[ "$root_controlled" -eq 1 ]]; then
            hapi_claude_oauth_secure_chmod_chown "$token_file" "root:root" || return 1
        elif [[ -n "$owner" && "$scope" == system ]]; then
            hapi_claude_oauth_secure_chmod_chown "$token_file" "$owner" || return 1
        else
            hapi_claude_oauth_secure_chmod_chown "$token_file" || return 1
        fi
        if hapi_claude_oauth_has_effective_token "$token_file"; then
            echo "Claude OAuth token file present: $token_file"
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
            echo "WARN: $token_file exists but has no effective CLAUDE_CODE_OAUTH_TOKEN= value" >&2
            hapi_print_claude_oauth_setup_instructions "$token_file" "$runner_unit" "$scope"
        fi
    else
        hapi_print_claude_oauth_setup_instructions "$token_file" "$runner_unit" "$scope"
    fi

    case "$scope" in
        system)
            systemctl daemon-reload || {
                echo "ERROR: systemctl daemon-reload failed after installing $dropin" >&2
                return 1
            }
            ;;
        user)
            systemctl --user daemon-reload || {
                echo "ERROR: systemctl --user daemon-reload failed after installing $dropin" >&2
                return 1
            }
            ;;
    esac
}
