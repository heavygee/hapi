#!/usr/bin/env bash
# hapi-pet-install: one-shot install/upgrade for a standalone ("pet") HAPI instance —
# a single machine with no orchestrator, no persistent-volume swap, no fleet management
# (a Chromebook's Linux/Crostini container, a fresh VPS, any hand-set-up Linux box).
#
# Safe to re-run: running this again on an already-installed box performs an in-place
# upgrade (validate new binary -> stop old -> swap -> relaunch), same mechanism proven
# by hand on antevorta/janus/pet-chromebook-sim, 2026-09-11 through 2026-09-13. The new
# binary is fetched and sanity-checked BEFORE anything running is touched, specifically
# so a bad HAPI_ARTIFACT_URL can never leave the box with nothing running.
#
# Does everything EXCEPT authenticate Claude Code — that step requires a real
# interactive login or Anthropic account token and is deliberately left to the user.
#
# Usage:
#   HAPI_ARTIFACT_URL=<url-or-path-to-hapi-binary> bash install-hapi-pet.sh
#   curl -fsSL …/install-hapi-pet.sh | bash
#   curl -fsSL …/install-hapi-pet.sh | bash -s -- --no-systemd
# Default: user systemd units when a user session actually works; otherwise nohup.
# --with-systemd / --no-systemd force one path.
#
# See docs/plans/2026-09-04-fleet-vm-swap-strategy.md §6 for the full history of what
# this script encodes and why each step exists — every step here was a real bug found
# by literally following a hand-written cheat sheet on a fresh box, then by literally
# running this script itself on a fresh box.

set -euo pipefail

HAPI_HOME="${HAPI_HOME:-$HOME/.hapi}"
HAPI_WORKSPACE="${HAPI_WORKSPACE:-$HOME/.hapi-workspace}"
HAPI_ARTIFACT_URL="${HAPI_ARTIFACT_URL:-}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
NVM_VERSION="v0.39.7"
NODE_MIN_MAJOR=22
STOP_TIMEOUT_SECS=15
WITH_SYSTEMD=0
SYSTEMD_PREF=auto

# curl|bash leaves BASH_SOURCE[0] empty under `set -u`. Never rely on a repo-relative
# path for --with-systemd — that only works from a real git checkout.
_script_src="${BASH_SOURCE[0]:-}"
if [[ -n "$_script_src" && -f "$_script_src" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$_script_src")" && pwd)"
else
    SCRIPT_DIR=""
fi
unset _script_src

log()  { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

# True when systemd --user can actually manage units for this login, not merely
# when `systemctl` exists on PATH. HAPI_PET_PID1_COMM is a test hook.
hapi_pet_systemd_user_available() {
    [[ -z "${HAPI_PET_TEST_NO_SYSTEMCTL:-}" ]] || return 1
    command -v systemctl >/dev/null 2>&1 || return 1
    local pid1
    pid1="${HAPI_PET_PID1_COMM:-}"
    if [[ -z "$pid1" ]]; then
        pid1="$(tr -d '\0\n' </proc/1/comm 2>/dev/null || true)"
    fi
    [[ "$pid1" == systemd ]] || return 1
    local runtime
    runtime="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    [[ -S "${runtime}/systemd/private" || -S "${runtime}/bus" ]] || return 1
    systemctl --user show-environment >/dev/null 2>&1
}

# SYSTEMD_PREF=auto|on|off → WITH_SYSTEMD=0|1
hapi_pet_resolve_with_systemd() {
    case "${SYSTEMD_PREF:-auto}" in
        off)
            WITH_SYSTEMD=0
            log "Using nohup (--no-systemd)."
            ;;
        on)
            WITH_SYSTEMD=1
            log "Using systemd user units (--with-systemd)."
            ;;
        auto)
            if hapi_pet_systemd_user_available; then
                WITH_SYSTEMD=1
                log "systemd user session detected — installing user units (override with --no-systemd)."
            else
                WITH_SYSTEMD=0
                log "no usable systemd user session — using nohup (override with --with-systemd)."
            fi
            ;;
        *)
            fail "internal: bad SYSTEMD_PREF=${SYSTEMD_PREF}"
            ;;
    esac
}

for arg in "$@"; do
    case "$arg" in
        --with-systemd)
            [[ "$SYSTEMD_PREF" == auto || "$SYSTEMD_PREF" == on ]] || fail "cannot combine --with-systemd and --no-systemd"
            SYSTEMD_PREF=on
            ;;
        --no-systemd)
            [[ "$SYSTEMD_PREF" == auto || "$SYSTEMD_PREF" == off ]] || fail "cannot combine --with-systemd and --no-systemd"
            SYSTEMD_PREF=off
            ;;
        -h|--help)
            cat <<'HELP'
hapi-pet-install: one-shot install/upgrade for a standalone ("pet") HAPI instance.

Usage:
  HAPI_ARTIFACT_URL=<url-or-path> bash install-hapi-pet.sh
  curl -fsSL …/install-hapi-pet.sh | bash
  curl -fsSL …/install-hapi-pet.sh | bash -s -- --no-systemd
  curl -fsSL …/install-hapi-pet.sh | bash -s -- --with-systemd

Default: detect a working systemd user session and install user units
(survives logout when linger is on). If systemd --user is not actually
usable, fall back to nohup automatically.

--with-systemd  Force user-level systemd units (fail if systemctl --user cannot run).
--no-systemd    Force nohup even when a user session is available.
HELP
            exit 0
            ;;
    esac
done

# Prefer the checkout OAuth helpers when present (curl|bash has none).
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/tooling/lib/hapi-claude-oauth-dropin.sh" ]]; then
    # shellcheck source=tooling/lib/hapi-claude-oauth-dropin.sh
    source "${SCRIPT_DIR}/tooling/lib/hapi-claude-oauth-dropin.sh"
fi

# Embed systemd EnvironmentFile value parser for curl|bash (keep in sync with
# hapi_claude_oauth_parse_env_file_value in lib/hapi-claude-oauth-dropin.sh).
if ! declare -F hapi_claude_oauth_parse_env_file_value >/dev/null 2>&1; then
    hapi_claude_oauth_parse_env_file_value() {
        local raw="${1-}"
        raw="${raw%$'\r'}"
        raw="${raw#"${raw%%[![:space:]]*}"}"
        raw="${raw%"${raw##*[![:space:]]}"}"
        [[ -n "$raw" ]] || return 1

        local out="" i=0 c nxt state=pre
        while (( i < ${#raw} )); do
            c="${raw:i:1}"
            case "$state" in
                pre)
                    if [[ "$c" =~ [[:space:]] ]]; then
                        i=$((i + 1)); continue
                    fi
                    if [[ "$c" == "'" ]]; then
                        state=sq; i=$((i + 1)); continue
                    fi
                    if [[ "$c" == '"' ]]; then
                        state=dq; i=$((i + 1)); continue
                    fi
                    if [[ "$c" == '\' ]]; then
                        state=val
                        if (( i + 1 < ${#raw} )); then
                            out+="${raw:i+1:1}"; i=$((i + 2))
                        else
                            out+='\'; i=$((i + 1))
                        fi
                        continue
                    fi
                    state=val; out+="$c"; i=$((i + 1)); continue
                    ;;
                sq)
                    if [[ "$c" == "'" ]]; then state=pre; else out+="$c"; fi
                    i=$((i + 1)); continue
                    ;;
                dq)
                    if [[ "$c" == '\' && $((i + 1)) -lt ${#raw} ]]; then
                        nxt="${raw:i+1:1}"
                        case "$nxt" in
                            "\\"|'"'|'`'|'$') out+="$nxt" ;;
                            *) out+="\\$nxt" ;;
                        esac
                        i=$((i + 2)); continue
                    fi
                    if [[ "$c" == '"' ]]; then
                        state=pre; i=$((i + 1)); continue
                    fi
                    out+="$c"; i=$((i + 1)); continue
                    ;;
                val)
                    if [[ "$c" == '\' && $((i + 1)) -lt ${#raw} ]]; then
                        out+="${raw:i+1:1}"; i=$((i + 2)); continue
                    fi
                    out+="$c"; i=$((i + 1)); continue
                    ;;
            esac
        done
        [[ "$state" != sq && "$state" != dq ]] || return 1
        [[ -n "$out" ]] || return 1
        printf '%s' "$out"
        return 0
    }
fi
if ! declare -F hapi_claude_oauth_env_line_state >/dev/null 2>&1; then
    hapi_claude_oauth_env_line_state() {
        local buf="${1-}"
        HAPI_EF_QUOTE=""
        HAPI_EF_CONT_BS=0
        [[ "$buf" == *"="* ]] || return 0
        local val="${buf#*=}"
        val="${val#"${val%%[![:space:]]*}"}"
        local i=0 c quote="" pre=1
        while (( i < ${#val} )); do
            c="${val:i:1}"
            if [[ -z "$quote" ]]; then
                if [[ "$pre" -eq 1 ]]; then
                    if [[ "$c" =~ [[:space:]] ]]; then
                        i=$((i + 1)); continue
                    fi
                    if [[ "$c" == "'" ]]; then
                        quote="'"; i=$((i + 1)); continue
                    fi
                    if [[ "$c" == '"' ]]; then
                        quote='"'; i=$((i + 1)); continue
                    fi
                    if [[ "$c" == '\' ]]; then
                        pre=0
                        if (( i + 1 >= ${#val} )); then
                            HAPI_EF_CONT_BS=1
                            return 0
                        fi
                        i=$((i + 2)); continue
                    fi
                    pre=0
                    i=$((i + 1)); continue
                fi
                if [[ "$c" == '\' ]]; then
                    if (( i + 1 >= ${#val} )); then
                        HAPI_EF_CONT_BS=1
                        return 0
                    fi
                    i=$((i + 2)); continue
                fi
                i=$((i + 1)); continue
            fi
            if [[ "$quote" == "'" ]]; then
                if [[ "$c" == "'" ]]; then
                    quote=""; pre=1
                fi
                i=$((i + 1)); continue
            fi
            if [[ "$c" == '\' ]]; then
                if (( i + 1 >= ${#val} )); then
                    HAPI_EF_QUOTE='"'
                    HAPI_EF_CONT_BS=1
                    return 0
                fi
                i=$((i + 2)); continue
            fi
            if [[ "$c" == '"' ]]; then
                quote=""; pre=1
            fi
            i=$((i + 1))
        done
        HAPI_EF_QUOTE="$quote"
        HAPI_EF_CONT_BS=0
    }
fi
if ! declare -F hapi_claude_oauth_env_line_key >/dev/null 2>&1; then
    hapi_claude_oauth_env_line_key() {
        local s="${1-}"
        HAPI_EF_KEY=""
        HAPI_EF_RAW=""
        s="${s#"${s%%[![:space:]]*}"}"
        case "$s" in
            ''|\#*|\;*) return 1 ;;
        esac
        [[ "$s" == *=* ]] || return 1
        HAPI_EF_KEY="${s%%=*}"
        HAPI_EF_KEY="${HAPI_EF_KEY%"${HAPI_EF_KEY##*[![:space:]]}"}"
        HAPI_EF_RAW="${s#*=}"
        return 0
    }
fi
if ! declare -F hapi_claude_oauth_bash_last_oauth_token >/dev/null 2>&1; then
    hapi_claude_oauth_bash_last_oauth_token() {
        local token_file="${1:?token_file}"
        local line raw last="" parsed logical="" join_nl=0
        while IFS= read -r line || [[ -n "$line" ]]; do
            line="${line%$'\r'}"
            if [[ -z "$logical" ]]; then
                logical="$line"
            elif [[ "$join_nl" -eq 1 ]]; then
                logical+=$'\n'"$line"
            else
                logical+="$line"
            fi
            hapi_claude_oauth_env_line_state "$logical"
            if [[ "$HAPI_EF_CONT_BS" -eq 1 && "$logical" == *\\ ]]; then
                logical="${logical%\\}"
                join_nl=0
                continue
            fi
            if [[ -n "$HAPI_EF_QUOTE" ]]; then
                join_nl=1
                continue
            fi
            if hapi_claude_oauth_env_line_key "$logical" && [[ "$HAPI_EF_KEY" == "CLAUDE_CODE_OAUTH_TOKEN" ]]; then
                raw="$HAPI_EF_RAW"
                if parsed="$(hapi_claude_oauth_parse_env_file_value "$raw")"; then
                    last="$parsed"
                else
                    last=""
                fi
            fi
            logical=""
            join_nl=0
        done <"$token_file"
        if [[ -n "$logical" ]]; then
            if hapi_claude_oauth_env_line_key "$logical" && [[ "$HAPI_EF_KEY" == "CLAUDE_CODE_OAUTH_TOKEN" ]]; then
                raw="$HAPI_EF_RAW"
                if parsed="$(hapi_claude_oauth_parse_env_file_value "$raw")"; then
                    last="$parsed"
                else
                    last=""
                fi
            fi
        fi
        [[ -n "$last" ]] || return 2
        printf '%s' "$last"
        return 0
    }
fi

# Export CLAUDE_CODE_OAUTH_TOKEN from an EnvironmentFile literally (never `source`
# the file — shell would expand $, backticks, and abort under set -u).
hapi_pet_export_oauth_from_env_file() {
    local token_file="${1:?token_file}"
    local eff=""
    [[ -f "$token_file" && ! -L "$token_file" ]] || return 1
    if declare -F hapi_claude_oauth_effective_token_value >/dev/null 2>&1; then
        set +e
        eff="$(hapi_claude_oauth_effective_token_value "$token_file")"
        local rc=$?
        set -e
        [[ "$rc" -eq 0 && -n "$eff" ]] || return 1
    else
        # Last-assignment parser: quoted newlines + trailing-backslash continuations.
        set +e
        eff="$(hapi_claude_oauth_bash_last_oauth_token "$token_file")"
        local rc=$?
        set -e
        [[ "$rc" -eq 0 && -n "$eff" ]] || return 1
    fi
    export CLAUDE_CODE_OAUTH_TOKEN="$eff"
    return 0
}

# 0=ambient token, 1=no process/no token, 2=live pid unreadable (fail closed).
hapi_pet_mainpid_oauth() {
    local pid="${1:-0}" tok="" line efd
    if declare -F hapi_claude_oauth_mainpid_has_oauth_token >/dev/null 2>&1; then
        hapi_claude_oauth_mainpid_has_oauth_token "$pid"
        return $?
    fi
    [[ "$pid" =~ ^[0-9]+$ ]] || return 2
    if [[ "$pid" == "0" ]]; then
        return 1
    fi
    if [[ ! -d "/proc/$pid" ]]; then
        return 1
    fi
    if [[ ! -r "/proc/$pid/environ" ]]; then
        return 2
    fi
    exec {efd}<"/proc/$pid/environ" || return 2
    while IFS= read -r -d '' -u "$efd" line || [[ -n "$line" ]]; do
        case "$line" in
            CLAUDE_CODE_OAUTH_TOKEN=*) tok="${line#CLAUDE_CODE_OAUTH_TOKEN=}" ;;
        esac
    done
    exec {efd}<&-
    [[ -n "$tok" ]]
}

hapi_pet_assert_runner_owned_dir() {
    local d="${1:?dir}"
    local want="${2:?uid}"
    local uid mode
    if [[ -L "$d" ]]; then
        fail "user token parent is a symlink: $d"
    fi
    if [[ ! -d "$d" ]]; then
        fail "user token parent is not a directory: $d"
    fi
    uid="$(stat -c '%u' "$d" 2>/dev/null || true)"
    mode="$(stat -c '%a' "$d" 2>/dev/null || true)"
    if [[ "$uid" != "$want" ]]; then
        fail "user token parent $d is owned by uid ${uid:-unknown} (must be runner uid $want)"
    fi
    if [[ -z "$mode" ]] || (( (8#$mode & 022) != 0 )); then
        fail "user token parent $d is group/other-writable (mode ${mode:-unknown})"
    fi
}

hapi_pet_assert_user_token_parents() {
    local token_file="${1:?token_file}"
    local want_uid="${2:-$(id -u)}"
    local home="${HOME:-}"
    local cur nxt uid mode
    if declare -F hapi_claude_oauth_assert_user_token_parents >/dev/null 2>&1; then
        hapi_claude_oauth_assert_user_token_parents "$token_file" "$want_uid" \
            || fail "user token parent is not runner-owned / is group-or-other-writable"
        return 0
    fi
    cur="$(dirname -- "$token_file")"
    hapi_pet_assert_runner_owned_dir "$cur" "$want_uid"
    while true; do
        nxt="$(dirname -- "$cur")"
        if [[ "$nxt" == "/" || "$nxt" == "/tmp" || "$nxt" == "/var/tmp" ]]; then
            return 0
        fi
        if [[ -n "$home" && "$nxt" == "$home" ]]; then
            hapi_pet_assert_runner_owned_dir "$nxt" "$want_uid"
            return 0
        fi
        if [[ -L "$nxt" ]]; then
            fail "user token ancestor is a symlink: $nxt"
        fi
        if [[ ! -d "$nxt" ]]; then
            fail "user token ancestor is not a directory: $nxt"
        fi
        uid="$(stat -c '%u' "$nxt" 2>/dev/null || true)"
        mode="$(stat -c '%a' "$nxt" 2>/dev/null || true)"
        if [[ "$uid" != "$want_uid" && "$uid" != "0" ]]; then
            fail "user token ancestor $nxt is owned by uid ${uid:-unknown} (must be runner uid $want_uid or root)"
        fi
        if [[ -z "$mode" ]] || (( (8#$mode & 022) != 0 )); then
            fail "user token ancestor $nxt is group/other-writable (mode ${mode:-unknown})"
        fi
        cur="$nxt"
    done
}

# Migrate ${HAPI_HOME}/.hapi/claude-setup-token.env → canonical before the
# embedded drop-in points EnvironmentFile at the (otherwise missing) canon.
# Companion path uses hapi_install_claude_oauth_dropin; curl|bash must do this
# itself or upgrades wipe ambient auth on the next runner restart.
hapi_pet_migrate_legacy_oauth_if_needed() {
    local token_file="${1:?token_file}"
    local hapi_home legacy_token dest tmp canon_ok=0
    hapi_home="$(dirname "$token_file")"
    legacy_token="${hapi_home}/.hapi/claude-setup-token.env"

    # Subshell: export helper must not pollute the installer environment.
    if ( hapi_pet_export_oauth_from_env_file "$token_file" >/dev/null 2>&1 ); then
        canon_ok=1
    fi
    [[ -e "$legacy_token" || -L "$legacy_token" ]] || return 0

    if [[ -L "$legacy_token" ]]; then
        fail "refusing symlink legacy token: $legacy_token (write a regular 0600 file)"
    fi
    if [[ ! -f "$legacy_token" ]]; then
        fail "refusing non-regular legacy token: $legacy_token (write a regular 0600 file)"
    fi

    # Canon already effective: still retire leftover legacy (retry retirement) so a
    # later empty/missing canon cannot re-import a revoked credential.
    if [[ "$canon_ok" -eq 1 ]]; then
        if declare -F hapi_claude_oauth_retire_legacy_token_source >/dev/null 2>&1; then
            hapi_claude_oauth_retire_legacy_token_source "$legacy_token" \
                || fail "could not retire leftover legacy Claude OAuth token: $legacy_token"
        else
            dest="${legacy_token}.migrated.$(date +%s)"
            mv -n -- "$legacy_token" "$dest" \
                || fail "could not retire leftover legacy Claude OAuth token: $legacy_token"
            log "Retired legacy Claude OAuth token: $legacy_token -> $dest"
        fi
        return 0
    fi

    if declare -F hapi_claude_oauth_secure_copy_regular_file >/dev/null 2>&1; then
        hapi_claude_oauth_secure_copy_regular_file "$legacy_token" "$token_file" \
            || fail "could not migrate legacy Claude OAuth token: $legacy_token -> $token_file"
        log "Migrated Claude OAuth token: $legacy_token -> $token_file"
        if declare -F hapi_claude_oauth_retire_legacy_token_source >/dev/null 2>&1; then
            hapi_claude_oauth_retire_legacy_token_source "$legacy_token" \
                || fail "migrated but could not retire legacy source: $legacy_token"
        fi
        return 0
    fi

    # curl|bash (no checkout helpers): bash copy under $HAPI_HOME only — never /etc.
    /bin/mkdir -p "$hapi_home" || fail "mkdir $hapi_home failed during legacy OAuth migrate"
    if [[ -L "$token_file" ]]; then
        fail "refusing to overwrite symlink canonical token: $token_file"
    fi
    tmp="$(/usr/bin/mktemp "${hapi_home}/.claude-oauth-copy.XXXXXX")" \
        || fail "mktemp failed during legacy OAuth migrate"
    if ! /bin/cp -f -- "$legacy_token" "$tmp"; then
        /bin/rm -f -- "$tmp"
        fail "could not copy legacy Claude OAuth token: $legacy_token"
    fi
    if [[ -L "$tmp" ]]; then
        /bin/rm -f -- "$tmp"
        fail "temp copy became a symlink during legacy OAuth migrate: $tmp"
    fi
    /bin/chmod 600 "$tmp" || { /bin/rm -f -- "$tmp"; fail "chmod 600 failed on migrate temp"; }
    if ! /bin/mv -f -- "$tmp" "$token_file"; then
        /bin/rm -f -- "$tmp"
        fail "could not install migrated Claude OAuth token at $token_file"
    fi
    log "Migrated Claude OAuth token: $legacy_token -> $token_file"
    dest="${legacy_token}.migrated.$(date +%s)"
    mv -n -- "$legacy_token" "$dest" \
        || fail "migrated but could not retire legacy source: $legacy_token"
    /bin/chmod 600 "$dest" \
        || fail "could not chmod 600 retired legacy token: $dest"
    log "Retired legacy Claude OAuth token: $legacy_token -> $dest"
    return 0
}

# User-level systemd units for pet installs. Embedded so curl|bash works without a
# repo checkout. Keep in sync with scripts/tooling/systemd/units/user-pet/*.in —
# the checkout path below prefers the companion installer when present.
install_user_pet_systemd() {
    local companion=""
    if [[ -n "${SCRIPT_DIR}" && -x "${SCRIPT_DIR}/tooling/install-hapi-systemd-units.sh" ]]; then
        companion="${SCRIPT_DIR}/tooling/install-hapi-systemd-units.sh"
    fi
    if [[ -n "$companion" ]]; then
        log "Using companion systemd installer from checkout: $companion"
        # Defence in depth for the 2026-09-30 HAPI_BIN poisoning: pass the pet
        # binary explicitly so a stale global default cannot point ExecStart at
        # /opt/hapi/hapi (203/EXEC on any host without that path).
        HAPI_WORKSPACE="$HAPI_WORKSPACE" HAPI_HOME="$HAPI_HOME" INSTALL_DIR="$INSTALL_DIR" \
            bash "$companion" --profile user-pet --enable --hapi-bin "${INSTALL_DIR}/hapi"
        return 0
    fi

    log "No git checkout — writing embedded user systemd units"
    command -v systemctl >/dev/null 2>&1 || fail "systemctl not found — cannot install --with-systemd on this host"
    local hapi_bin="$INSTALL_DIR/hapi"
    local hapi_path="$INSTALL_DIR:$HOME/.bun/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
    local host_label
    host_label="$(hostname -s 2>/dev/null || hostname || echo pet)"
    local unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$unit_dir"

    cat >"$unit_dir/hapi-hub.service" <<EOF
[Unit]
Description=HAPI Hub (${host_label})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HAPI_HOME=${HAPI_HOME}
Environment=PATH=${hapi_path}
ExecStart=${hapi_bin} hub
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    cat >"$unit_dir/hapi-runner.service" <<EOF
[Unit]
Description=HAPI Runner (${host_label})
After=network-online.target hapi-hub.service
Wants=network-online.target

[Service]
Type=simple
KillMode=process
Environment=HAPI_HOME=${HAPI_HOME}
Environment=PATH=${hapi_path}
Environment=HAPI_RUNNER_SUPERVISED=1
Environment=HAPI_DISABLE_VERSION_HANDOFF=1
# Must mirror scripts/tooling/systemd/units/user-pet/hapi-runner.service.in.
# HAPI_DISABLE_VERSION_HANDOFF=1 stops a fresh invocation treating the running
# runner as stale, so without this stop a restart hits the runner's dedup path
# (exit 0, "keeping existing runner") and leaves the unit inactive with an
# unsupervised runner alive — or, with Restart=always, cycling until the start
# limit trips. The curl|bash path writes THIS unit, not the template, so the
# guard has to exist in both places.
ExecStartPre=-${hapi_bin} runner stop
ExecStart=${hapi_bin} runner start-sync --workspace-root ${HAPI_WORKSPACE}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    # Claude OAuth EnvironmentFile drop-in (same shape as fleet/oos). Leading
    # '-' means the unit still starts before the operator mints a setup-token.
    local token_file="${HAPI_HOME}/claude-setup-token.env"
    mkdir -p "$unit_dir/hapi-runner.service.d"
    if [[ ! -d "$HAPI_HOME" ]]; then
        mkdir -m 0700 -p "$HAPI_HOME" || fail "cannot create $HAPI_HOME"
    fi
    hapi_pet_assert_user_token_parents "$token_file"
    # Migrate legacy nohup path BEFORE writing the drop-in / restarting — otherwise
    # EnvironmentFile points at a missing canon and the runner loses ambient auth.
    hapi_pet_migrate_legacy_oauth_if_needed "$token_file"
    local dropin="$unit_dir/hapi-runner.service.d/42-claude-oauth-token.conf"
    if [[ -L "$dropin" ]]; then
        fail "refusing symlink drop-in: $dropin"
    fi
    if [[ -e "$dropin" && ! -f "$dropin" ]]; then
        fail "refusing non-regular drop-in: $dropin"
    fi
    local dropin_tmp
    dropin_tmp="$(mktemp "$unit_dir/hapi-runner.service.d/.42-claude-oauth-token.conf.XXXXXX")" \
        || fail "cannot create temp drop-in"
    cat >"$dropin_tmp" <<EOF
[Service]
EnvironmentFile=-${token_file}
EOF
    chmod 0644 "$dropin_tmp"
    mv -f "$dropin_tmp" "$dropin"
    log "Installed: $dropin -> $token_file"

    # Tighten an existing token even when the setup banner is skipped (curl/embedded
    # path does not go through hapi_install_claude_oauth_dropin).
    if [[ -L "$token_file" ]]; then
        fail "refusing symlink token file: $token_file (write a regular 0600 file)"
    elif [[ -e "$token_file" && ! -f "$token_file" ]]; then
        fail "refusing non-regular token file: $token_file (write a regular 0600 file)"
    elif [[ -f "$token_file" ]]; then
        chmod 600 "$token_file"
    fi

    systemctl --user daemon-reload
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
    systemctl --user enable hapi-hub.service hapi-runner.service
    # Always restart hub+runner AFTER units/drop-in are written. On upgrades
    # section 4's pgrep kill + Restart=always can respawn the *old* binary
    # before INSTALL_DIR is swapped; systemctl start is then a no-op for the
    # already-active unit and the hub keeps running the deleted executable
    # while only the runner would get the new binary.
    # Refuse runner restart when MainPID still holds ambient-only auth.
    if ! ( hapi_pet_export_oauth_from_env_file "$token_file" >/dev/null 2>&1 ); then
        local _rp _orc
        _rp="$(systemctl --user show -p MainPID --value hapi-runner.service 2>/dev/null || echo 0)"
        set +e
        hapi_pet_mainpid_oauth "$_rp"
        _orc=$?
        set -e
        case "$_orc" in
            0)
                fail "user-pet runner MainPID=$_rp has ambient CLAUDE_CODE_OAUTH_TOKEN but $token_file is missing/empty — persist the token before restart"
                ;;
            2)
                fail "cannot inspect user-pet runner MainPID=$_rp environ for ambient OAuth — refusing restart"
                ;;
        esac
    fi
    if declare -F hapi_claude_oauth_merged_env_discards_token >/dev/null 2>&1; then
        if hapi_claude_oauth_merged_env_discards_token hapi-runner.service "$token_file" --user; then
            fail "merged user hapi-runner.service environment would override or unset CLAUDE_CODE_OAUTH_TOKEN — refusing restart"
        fi
    else
        local _ue _ef _saw=0 _p _ign _miss _grc
        _ue="$(systemctl --user show hapi-runner.service -p UnsetEnvironment --value 2>/dev/null || true)"
        if [[ "$_ue" =~ (^|[[:space:]])CLAUDE_CODE_OAUTH_TOKEN(=|[[:space:]]|$) ]]; then
            fail "merged user hapi-runner.service UnsetEnvironment removes CLAUDE_CODE_OAUTH_TOKEN — refusing restart"
        fi
        _ef="$(systemctl --user show hapi-runner.service -p EnvironmentFiles --value 2>/dev/null || true)"
        while IFS=$'\t' read -r _p _ign || [[ -n "${_p-}" ]]; do
            [[ -n "$_p" ]] || continue
            _miss=0
            [[ -e "$_p" || -L "$_p" ]] || _miss=1
            if [[ "$_miss" -eq 1 && "$_ign" == "no" ]]; then
                fail "required EnvironmentFile is missing ($_p) — refusing restart"
            fi
            if [[ "$_miss" -eq 1 ]]; then
                [[ "$_p" == "$token_file" ]] && _saw=1
                continue
            fi
            if [[ "$_ign" == "no" ]]; then
                if [[ ! -f "$_p" ]]; then
                    fail "required EnvironmentFile is not a regular file ($_p) — refusing restart"
                fi
                if [[ ! -r "$_p" ]]; then
                    fail "required EnvironmentFile is unreadable ($_p) — refusing restart"
                fi
            fi
            if [[ "$_p" == "$token_file" ]]; then
                _saw=1
                continue
            fi
            [[ "$_saw" -eq 1 ]] || continue
            if [[ -L "$_p" ]]; then
                fail "later EnvironmentFile is a symlink ($_p) — refusing restart"
            fi
            if [[ -f "$_p" ]]; then
                if [[ ! -r "$_p" ]]; then
                    fail "later EnvironmentFile is unreadable ($_p) — refusing restart"
                fi
                _grc=0
                set +e
                grep -qE '^[[:space:]]*CLAUDE_CODE_OAUTH_TOKEN[[:space:]]*=' "$_p"
                _grc=$?
                set -e
                if [[ "$_grc" -eq 0 ]]; then
                    fail "later EnvironmentFile $_p overrides CLAUDE_CODE_OAUTH_TOKEN — refusing restart"
                fi
                if [[ "$_grc" -ne 1 ]]; then
                    fail "later EnvironmentFile is unreadable ($_p) — refusing restart"
                fi
            fi
        done < <(hapi_claude_oauth_iter_environment_files "$_ef" 2>/dev/null || printf '%s' "$_ef" | sed -E 's/ \(ignore_errors=(yes|no)\)/\t\1\n/g')
        if [[ "$_saw" -ne 1 ]]; then
            fail "canonical EnvironmentFile $token_file is not in merged user hapi-runner.service EnvironmentFiles — refusing restart"
        fi
    fi
    systemctl --user restart hapi-hub.service
    systemctl --user restart hapi-runner.service
    log "Installed: $unit_dir/hapi-hub.service"
    log "Installed: $unit_dir/hapi-runner.service"
    # Last-assignment-wins (systemd EnvironmentFile): a nonempty early line then
    # CLAUDE_CODE_OAUTH_TOKEN= still means unconfigured.
    local token_configured=0
    if [[ -f "$token_file" && ! -L "$token_file" ]]; then
        local line raw last=""
        while IFS= read -r line || [[ -n "$line" ]]; do
            case "$line" in
                CLAUDE_CODE_OAUTH_TOKEN=*)
                    raw="${line#CLAUDE_CODE_OAUTH_TOKEN=}"
                    raw="${raw%$'\r'}"
                    if [[ ${#raw} -ge 2 ]]; then
                        if [[ "${raw:0:1}" == '"' && "${raw: -1}" == '"' ]] || \
                           [[ "${raw:0:1}" == "'" && "${raw: -1}" == "'" ]]; then
                            raw="${raw:1:${#raw}-2}"
                        fi
                    fi
                    raw="${raw#"${raw%%[![:space:]]*}"}"
                    raw="${raw%"${raw##*[![:space:]]}"}"
                    last="$raw"
                    ;;
            esac
        done <"$token_file"
        [[ -n "$last" ]] && token_configured=1
    fi
    if [[ "$token_configured" -eq 0 ]]; then
        cat <<EOF

==> Claude OAuth for runner-spawned sessions is NOT configured yet.
    New UI sessions will print "Not logged in · Please run /login" until you:
      claude setup-token
      umask 077
      printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' > '$token_file'
      chmod 600 '$token_file'
      systemctl --user restart hapi-runner.service
    Existing --resume sessions can keep working and hide this gap - do not skip it.
EOF
    fi
}

# --- 1. Architecture detection ---
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  HAPI_PLATFORM="linux-x64-baseline" ;;
    aarch64) HAPI_PLATFORM="linux-arm64" ;;
    *) fail "Unsupported architecture: $ARCH (only linux-x64 / linux-arm64 pet installs are covered so far)" ;;
esac
log "Architecture: $ARCH -> $HAPI_PLATFORM"

# --- 2. Resolve artifact source ---
# Default: GitHub Releases mirror on heavygee/hapi (soup single-exe publish).
# Override with HAPI_ARTIFACT_URL for a local path or a different mirror.
HAPI_RELEASES_REPO="${HAPI_RELEASES_REPO:-heavygee/hapi}"
if [[ -z "$HAPI_ARTIFACT_URL" ]]; then
    HAPI_ARTIFACT_URL="https://github.com/${HAPI_RELEASES_REPO}/releases/latest/download/hapi-${HAPI_PLATFORM}"
fi
log "Artifact source: $HAPI_ARTIFACT_URL"

# --- 3. Fetch + sanity-check the new binary BEFORE touching anything running.
#     Ordering is deliberate: a bad URL/path or a corrupt download must fail here,
#     with the previous install (if any) still fully untouched and running. ---
mkdir -p "$HOME/.cache"
TMP_BIN="$(mktemp "$HOME/.cache/hapi-pet-install.XXXXXX")"
trap 'rm -f "$TMP_BIN"' EXIT
if [[ "$HAPI_ARTIFACT_URL" =~ ^https?:// ]]; then
    curl -fsSL "$HAPI_ARTIFACT_URL" -o "$TMP_BIN" || fail "download from $HAPI_ARTIFACT_URL failed"
else
    [[ -f "$HAPI_ARTIFACT_URL" ]] || fail "no file at $HAPI_ARTIFACT_URL"
    cp "$HAPI_ARTIFACT_URL" "$TMP_BIN"
fi
chmod +x "$TMP_BIN"
"$TMP_BIN" --version >/dev/null 2>&1 || fail "fetched file at $TMP_BIN does not run (--version failed) — corrupt download or wrong architecture, nothing has been touched"
log "New binary fetched and verified runnable."

# --- 3b. Preflight Claude OAuth token shape BEFORE stopping anything.
#     Applies to BOTH --with-systemd and nohup upgrades: a symlink/non-regular
#     canonical (or legacy) token must fail here — not after section 4 killed the
#     old authenticated runner and left a replacement without CLAUDE_CODE_OAUTH_TOKEN.
#     Also migrate legacy → canonical here so nohup launch (canon-only) keeps auth.
#     Reject symlink *ancestors* (e.g. .hapi → elsewhere): final-node -f follows
#     them and would greenlight a path migrate later refuses.
_preflight_token_ancestors() {
    local path="$1"
    if declare -F hapi_claude_oauth_assert_no_symlink_ancestors >/dev/null 2>&1; then
        hapi_claude_oauth_assert_no_symlink_ancestors "$path" \
            || fail "refusing symlink ancestor in token path: $path — refusing before stop so the old install stays up"
        return 0
    fi
    local cur="" part
    local abs="$path"
    if [[ "$abs" != /* ]]; then
        abs="$(pwd)/$abs"
    fi
    cur=""
    IFS=/ read -r -a _pre_parts <<<"${abs#/}" || true
    for part in "${_pre_parts[@]}"; do
        [[ -n "$part" ]] || continue
        cur="${cur}/${part}"
        if [[ -L "$cur" ]]; then
            unset _pre_parts
            fail "refusing symlink path component: $cur (in $path) — refusing before stop so the old install stays up"
        fi
    done
    unset _pre_parts
}
_preflight_token_shape() {
    local path="$1"
    # Walk ancestors even when the leaf is absent — a symlinked .hapi dir
    # still breaks migrate after we would have stopped the old install.
    _preflight_token_ancestors "$path"
    if [[ -L "$path" ]]; then
        fail "refusing symlink token file: $path (write a regular 0600 file) — refusing before stop so the old install stays up"
    elif [[ -e "$path" && ! -f "$path" ]]; then
        fail "refusing non-regular token file: $path (write a regular 0600 file) — refusing before stop so the old install stays up"
    fi
}
# Canonical + legacy shape for both nohup and systemd — nohup launch only loads
# canon, so a bad legacy node must fail here before migrate/stop, not after.
_preflight_token_shape "${HAPI_HOME}/claude-setup-token.env"
_preflight_token_shape "${HAPI_HOME}/.hapi/claude-setup-token.env"
if [[ -d "$HAPI_HOME" ]] && declare -F hapi_claude_oauth_assert_user_token_parents >/dev/null 2>&1; then
    hapi_claude_oauth_assert_user_token_parents "${HAPI_HOME}/claude-setup-token.env" \
        || fail "user token parent $HAPI_HOME is not runner-owned / is group-or-other-writable — refusing before stop"
fi
# Promote legacy → canonical BEFORE stop. Systemd drop-in and nohup launch both
# read only ${HAPI_HOME}/claude-setup-token.env; treating legacy as "durable"
# without this migrate lets stop succeed then start an unauthenticated runner.
hapi_pet_migrate_legacy_oauth_if_needed "${HAPI_HOME}/claude-setup-token.env"

# Tighten canon mode/owner while the old runner is still alive. A root-owned
# 0644 file from `sudo tee` used to pass preflight then die on chmod after stop.
_pre_canon="${HAPI_HOME}/claude-setup-token.env"
if [[ -f "$_pre_canon" && ! -L "$_pre_canon" ]]; then
    if ! /bin/chmod 600 "$_pre_canon" 2>/dev/null; then
        fail "cannot chmod 600 $_pre_canon before stop (got $(stat -c '%a uid=%u' "$_pre_canon" 2>/dev/null || echo unreadable)) — old runner left running"
    fi
    _pre_mode="$(stat -c '%a' "$_pre_canon" 2>/dev/null || true)"
    _pre_uid="$(stat -c '%u' "$_pre_canon" 2>/dev/null || true)"
    if [[ "$_pre_mode" != "600" || "$_pre_uid" != "$(id -u)" ]]; then
        fail "token $_pre_canon must be owned by $(id -un) mode 0600 before stop (got mode ${_pre_mode:-unknown} uid ${_pre_uid:-unknown}) — old runner left running"
    fi
fi

# Ambient-only guard: if no durable token file exists but a live runner still
# carries CLAUDE_CODE_OAUTH_TOKEN, refuse to stop — restart would discard it.
_pre_canon="${HAPI_HOME}/claude-setup-token.env"
_pre_legacy="${HAPI_HOME}/.hapi/claude-setup-token.env"
_pre_durable=0
if ( hapi_pet_export_oauth_from_env_file "$_pre_canon" >/dev/null 2>&1 ); then
    _pre_durable=1
elif ( hapi_pet_export_oauth_from_env_file "$_pre_legacy" >/dev/null 2>&1 ); then
    # Migrate should have cleared this; keep as failsafe so we still refuse stop.
    _pre_durable=1
fi
if [[ "$_pre_durable" -eq 0 ]]; then
    mapfile -t _pre_pids < <(pgrep -u "$(id -un)" -f 'hapi (hub|runner)' 2>/dev/null || true)
    for _pre_pid in "${_pre_pids[@]:-}"; do
        [[ -n "$_pre_pid" ]] || continue
        set +e
        hapi_pet_mainpid_oauth "$_pre_pid"
        _pre_orc=$?
        set -e
        case "$_pre_orc" in
            0)
                fail "runner pid=$_pre_pid has ambient CLAUDE_CODE_OAUTH_TOKEN but no durable token at $_pre_canon (or legacy $_pre_legacy) — refuse stop/restart; persist the token first"
                ;;
            2)
                fail "cannot inspect pid=$_pre_pid environ for ambient OAuth — refuse stop/restart"
                ;;
        esac
    done
    unset _pre_pids _pre_pid _pre_orc
fi
unset -f _preflight_token_shape _preflight_token_ancestors
unset _pre_canon _pre_legacy _pre_durable

# --- 4. Stop an already-running hub/runner, if any (upgrade path; no-op on fresh
#     install). Only reached after step 3's new binary is confirmed good. Waits for
#     the old process(es) to actually exit (not a blind sleep) before proceeding, so
#     the new hub never races the old one for :3006. ---
mapfile -t OLD_PIDS < <(pgrep -u "$(id -un)" -f 'hapi (hub|runner)' 2>/dev/null || true)
if [[ ${#OLD_PIDS[@]} -gt 0 ]]; then
    log "Found running hapi process(es), stopping for upgrade:"
    for pid in "${OLD_PIDS[@]}"; do
        ps -o pid=,cmd= -p "$pid" 2>/dev/null | sed 's/^/    /' || true
    done
    kill "${OLD_PIDS[@]}" 2>/dev/null || true
    waited=0
    while (( waited < STOP_TIMEOUT_SECS )); do
        still_alive=0
        for pid in "${OLD_PIDS[@]}"; do
            kill -0 "$pid" 2>/dev/null && still_alive=1
        done
        [[ "$still_alive" -eq 0 ]] && break
        sleep 1
        waited=$((waited + 1))
    done
    if (( waited >= STOP_TIMEOUT_SECS )); then
        log "Process(es) did not exit after ${STOP_TIMEOUT_SECS}s — sending SIGKILL"
        kill -9 "${OLD_PIDS[@]}" 2>/dev/null || true
        sleep 1
    fi
fi

# --- 5. Install to a user-writable location (never assumes sudo is present) ---
mkdir -p "$INSTALL_DIR"
mv "$TMP_BIN" "$INSTALL_DIR/hapi"
trap - EXIT
if ! grep -qF "export PATH=\"$INSTALL_DIR:" ~/.bashrc 2>/dev/null; then
    log "Adding $INSTALL_DIR to PATH via ~/.bashrc"
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
fi
case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *) export PATH="$INSTALL_DIR:$PATH" ;;
esac
log "hapi binary installed at $INSTALL_DIR/hapi ($(sha256sum "$INSTALL_DIR/hapi" | cut -d' ' -f1))"

# --- 6. Directories + persistent env (the hub does not create these itself) ---
mkdir -p "$HAPI_HOME/logs" "$HAPI_WORKSPACE"
if ! grep -q '^export HAPI_HOME=' ~/.bashrc 2>/dev/null; then
    echo "export HAPI_HOME=\"$HAPI_HOME\"" >> ~/.bashrc
fi
export HAPI_HOME

# --- 7. Launch ---
# systemd user units when a session is usable (or --with-systemd). Without: nohup.
# Skip nohup when systemd owns hub+runner so we do not race :3006.
hapi_pet_resolve_with_systemd
if [[ "$WITH_SYSTEMD" -eq 1 ]]; then
    install_user_pet_systemd
    sleep 2
    if ! curl -fsS localhost:3006/health >/dev/null; then
        fail "hub did not come up under systemd — check: systemctl --user status hapi-hub; journalctl --user -u hapi-hub -n 50"
    fi
    log "Hub is up under systemd (localhost:3006)."
    if ! systemctl --user is-active --quiet hapi-runner.service; then
        fail "runner did not stay up under systemd — check: systemctl --user status hapi-runner; journalctl --user -u hapi-runner -n 50"
    fi
    log "Runner is up under systemd, restricted to $HAPI_WORKSPACE."
else
    # Deliberately WITHOUT --relay: as of 2026-09-13 it fails silently (tunwg flag mismatch)
    # and falls back to a local-only hub with no visible error. Local-only is correct and
    # safe for same-machine use; flag this back to the meta-bot if you need remote reach
    # before that bug is fixed.
    nohup "$INSTALL_DIR/hapi" hub > "$HAPI_HOME/logs/hub.log" 2>&1 &
    sleep 2
    if ! curl -fsS localhost:3006/health >/dev/null; then
        fail "hub did not come up — check $HAPI_HOME/logs/hub.log"
    fi
    log "Hub is up (localhost:3006, local-only for now)."

    # Runner, restricted to the workspace dir created above — without --workspace-root the
    # runner starts in "legacy mode" with no directory restriction, which defeats the point
    # of having a dedicated workspace dir at all.
    # Load Claude OAuth literally from EnvironmentFile (do NOT source the file).
    # Legacy was migrated to canon in §3b; re-run migrate here so a mid-script
    # drop of only `.hapi/...` still reaches the nohup runner env.
    hapi_pet_migrate_legacy_oauth_if_needed "${HAPI_HOME}/claude-setup-token.env"
    (
        unset CLAUDE_CODE_OAUTH_TOKEN
        if [[ -f "$HAPI_HOME/claude-setup-token.env" && ! -L "$HAPI_HOME/claude-setup-token.env" ]]; then
            chmod 600 "$HAPI_HOME/claude-setup-token.env"
            hapi_pet_export_oauth_from_env_file "$HAPI_HOME/claude-setup-token.env" || true
        fi
        nohup "$INSTALL_DIR/hapi" runner start-sync --workspace-root "$HAPI_WORKSPACE" \
            > "$HAPI_HOME/logs/runner.log" 2>&1 &
        echo $! > "$HAPI_HOME/runner.pid"
    )
    RUNNER_PID="$(cat "$HAPI_HOME/runner.pid" 2>/dev/null || true)"
    sleep 2
    if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
        fail "runner exited immediately — check $HAPI_HOME/logs/runner.log"
    fi
    log "Runner started, restricted to $HAPI_WORKSPACE."
fi

# --- 8. Node.js (via nvm, no sudo needed) + Claude Code CLI ---
# Deliberately does NOT pre-check the existing Node version and skip nvm on "looks new
# enough" — a box can have a root-owned Node >=22 (e.g. from another admin's earlier
# system-wide install) where `npm install -g` would still hit the same no-write-access
# EACCES this whole nvm path exists to avoid. Try the plain install first; ANY failure
# (too old, no write access, no npm at all) falls through to nvm, which is always safe
# to run again if already installed (idempotent, confirmed 2026-09-13).
if ! command -v claude >/dev/null 2>&1; then
    log "Installing Claude Code CLI"
    if ! npm install -g @anthropic-ai/claude-code 2>/tmp/hapi-pet-npm-err.log; then
        log "System npm install failed (no npm, Node too old, or no write access) — installing Node ${NODE_MIN_MAJOR}+ via nvm instead"
        NVM_INSTALLER="$(mktemp "$HOME/.cache/nvm-install.XXXXXX")"
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" -o "$NVM_INSTALLER" \
            || fail "nvm installer download failed — check network/GitHub reachability"
        bash "$NVM_INSTALLER"
        rm -f "$NVM_INSTALLER"
        export NVM_DIR="$HOME/.nvm"
        # shellcheck source=/dev/null
        source "$NVM_DIR/nvm.sh"
        nvm install "$NODE_MIN_MAJOR"
        npm install -g @anthropic-ai/claude-code || fail "Claude Code CLI install failed even under nvm Node ${NODE_MIN_MAJOR} — see above"
    fi
    rm -f /tmp/hapi-pet-npm-err.log
fi

q_token_file="$(printf '%q' "${HAPI_HOME}/claude-setup-token.env")"
q_hapi_bin="$(printf '%q' "${INSTALL_DIR}/hapi")"
q_workspace="$(printf '%q' "${HAPI_WORKSPACE}")"
cat <<EOF

==> Install complete. Claude Code authentication is still a deliberate one-time step.

    IMPORTANT — open a NEW terminal (or run 'source ~/.bashrc') before the commands
    below. This script ran in its own subprocess; the PATH/nvm changes it made
    cannot reach back into the shell you launched it from. If you skip this and run
    the commands in the SAME terminal you just used, you will see the false error
    "Claude Code CLI not found on PATH" even though the install above succeeded —
    that failure mode means "wrong shell," not "broken install."

    For interactive CLI use:
      claude                # interactive OAuth login (needs a browser/display)

    For HAPI runner-spawned / UI sessions (required — interactive login alone is
    not enough for the runner process):
      claude setup-token    # headless: prints a URL, waits for a code
      umask 077
      printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' > ${q_token_file}
      chmod 600 ${q_token_file}
    Then reload the runner so it picks up the token:
      # systemd path (default when a user session was detected):
      systemctl --user restart hapi-runner.service
      # nohup path (--no-systemd, or no user session): export the token
      # literally (do NOT `source` the env file — shell expands $, backticks, etc).
      # Prefer 'hapi runner start' (stops the old runner and waits) over a raw
      # kill + start-sync race that can leave you with no runner at all.
      export CLAUDE_CODE_OAUTH_TOKEN='<token>'
      ${q_hapi_bin} runner start --workspace-root ${q_workspace}

    After that, confirm end-to-end:

      hapi --print "hello"

    "Claude Code CLI not found on PATH"  -> either you're still in the old shell
                                            (see above), or install genuinely didn't
                                            complete — re-check the log above
    "Not logged in - Please run /login"  -> runner ambient token missing/stale —
                                            redo the setup-token steps above, then
                                            restart the runner (systemd or nohup)
EOF
