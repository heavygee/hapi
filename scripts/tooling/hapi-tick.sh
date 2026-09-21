#!/usr/bin/env bash
# hapi-tick — declarative registry + systemd generator for bare (zero-token) pollers.
#
# Canon: docs/plans/2026-09-18-scheduled-agent-tasks-design.md
# Runbook: docs/tooling/hapi-tick.md
#
# Mechanical polls stay in bare scripts. This tool does NOT route through CronCreate
# or a hub cron table. Agents wake only via on_change (ntfy / spawn_peer / ping_peer)
# inside those probe scripts.
#
# Usage:
#   hapi tick list
#   hapi tick validate [name]
#   hapi tick install <name> [--force] [--run-now] [--dry-run]
#   hapi tick uninstall <name>
#   hapi tick run <name>
#   hapi tick doctor [name]
#   hapi tick templates
#
# Also: hapi-tick <subcommand> …  (PATH wrapper)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="${HAPI_TICKS_YAML:-$REPO_ROOT/config/ticks.yaml}"
TEMPLATES_DIR="$SCRIPT_DIR/tick-templates"
UNIT_OUT_DIR="$SCRIPT_DIR/systemd/ticks"
WATERMARK_LIB="$SCRIPT_DIR/lib/hapi-tick-watermark.sh"

# shellcheck source=lib/hapi-tick-watermark.sh
source "$WATERMARK_LIB"

err() { echo "hapi-tick: $*" >&2; }
die() { err "$*"; exit 2; }

usage() {
    sed -n '2,22p' "$0"
}

# Expand ~ in a path string (also used inside generated units as literal $HOME paths).
expand_user_path() {
    # $2 = optional passwd username (for sudo install expanding ~/ for service user)
    hapi_tick_expand_path "$1" "${2:-}"
}

# Prefer registry `.user`. When omitted: SUDO_USER under sudo, else invoking USER.
# Never default to root — sudo install must not emit User=root for mechanical probes.
# Always require a resolvable NSS/passwd account (systemd User= needs it).
resolve_tick_user() {
    local json="$1"
    local u
    u="$(tick_field "$json" '.user' "")"
    if [[ -z "$u" || "$u" == null ]]; then
        if [[ "$(id -u)" -eq 0 ]]; then
            if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
                u="$SUDO_USER"
            else
                die "tick user required under sudo (set .user in registry)"
            fi
        elif [[ -n "${USER:-}" && "$USER" != "root" ]]; then
            u="$USER"
        else
            die "tick user required (set .user in registry)"
        fi
    fi
    if ! getent passwd "$u" >/dev/null 2>&1; then
        die "unknown tick user '$u' (not in passwd/NSS)"
    fi
    printf '%s\n' "$u"
}

# Escape % for systemd path condition values (ConditionPathExists, etc.).
# Do NOT double $ here — that escaping is Exec*-only; $$ in a condition does
# not match a literal $ in the filesystem path (verified via systemd-analyze).
systemd_escape_condition_path() {
    local s="$1"
    s="${s//%/%%}"
    printf '%s' "$s"
}

# Escape $ and % for systemd Exec* arguments.
systemd_escape_exec_path() {
    local s="$1"
    s="${s//\$/\$\$}"
    s="${s//%/%%}"
    printf '%s' "$s"
}

# Quote a single systemd Exec* argument (paths may contain whitespace).
# systemd unit-file escapes: $$ for literal $, %% for literal % (not shell \$).
systemd_quote_arg() {
    local s
    s="$(systemd_escape_exec_path "$1")"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    printf '"%s"' "$s"
}

# True when the current process identity matches the configured tick user.
# Compare by UID so numeric User= values (e.g. 1000) match id -u.
same_tick_user() {
    local user="$1"
    local me_uid user_uid
    me_uid="$(id -u)"
    user_uid="$(id -u "$user" 2>/dev/null)" || return 1
    [[ "$me_uid" -eq "$user_uid" ]]
}

# Cache sudo credentials for $user when validate must run cross-user checks.
# Distinguishes "need a password prompt" from later permission failures.
ensure_as_user_sudo() {
    local user="$1"
    if same_tick_user "$user" || [[ "$(id -u)" -eq 0 ]]; then
        return 0
    fi
    if sudo -n -u "$user" -H -- true >/dev/null 2>&1; then
        return 0
    fi
    err "sudo required to validate as service user '$user'…"
    sudo -u "$user" -H -- true \
        || die "cannot sudo as user '$user' (needed to validate tick permissions)"
}

# Run test(1) as the service user (matches generated User=).
as_user_test() {
    local user="$1"
    shift
    if same_tick_user "$user"; then
        test "$@"
    else
        sudo -n -u "$user" -H -- test "$@"
    fi
}

# True if $user can create $dir (nearest existing ancestor must be writable
# and searchable — mkdir needs traverse/execute on the parent).
as_user_can_mkdir() {
    local user="$1" dir="$2" cur="$2"
    while [[ "$cur" != "/" && ! -d "$cur" ]]; do
        cur="$(dirname "$cur")"
    done
    as_user_test "$user" -w "$cur" && as_user_test "$user" -x "$cur"
}

# Safe unit/file identifier: letters, digits, underscore, hyphen; no /, @, dots.
assert_tick_name() {
    local name="$1"
    [[ -n "$name" ]] || die "tick name required"
    if [[ ! "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
        die "invalid tick name '$name' (use [A-Za-z0-9_-], start with alphanumeric; no / or @)"
    fi
}

# Emit KEY=value lines for registry .env (JSON-safe; rejects tab/newline values).
# Prints nothing if env empty. Dies on control characters in values.
registry_env_assignments() {
    local json="$1" name="${2:-tick}"
    if printf '%s' "$json" | jq -e '
        (.env // {}) | to_entries[]
        | select((.value | tostring) | test("[\t\n\r]"))
    ' >/dev/null 2>&1; then
        die "$name: env values must not contain tab/newline (use a file path instead)"
    fi
    printf '%s' "$json" | jq -r '
        (.env // {}) | to_entries[]
        | "\(.key)=\(.value | tostring)"
    '
}

# Resolve bun executable: BUN override, then PATH, then ~/.bun/bin.
resolve_bun() {
    if [[ -n "${BUN:-}" && -x "$BUN" ]]; then
        printf '%s\n' "$BUN"
        return 0
    fi
    if command -v bun >/dev/null 2>&1; then
        command -v bun
        return 0
    fi
    if [[ -x "${HOME}/.bun/bin/bun" ]]; then
        printf '%s\n' "${HOME}/.bun/bin/bun"
        return 0
    fi
    return 1
}

hostname_short() {
    hostname -s 2>/dev/null || hostname
}

# Emit JSON for one tick (or all) via python+yaml.
registry_json() {
    local name="${1:-}"
    # Prefer PyYAML; fall back to bun + repo `yaml` package (cli dep).
    if python3 -c 'import yaml' 2>/dev/null; then
        python3 - "$REGISTRY" "$name" <<'PY'
import json, sys, yaml
path, name = sys.argv[1], sys.argv[2]
with open(path) as f:
    doc = yaml.safe_load(f) or {}
ticks = doc.get("ticks") or []
names = [w.get("name") for w in ticks if w.get("name")]
dups = sorted({n for n in names if names.count(n) > 1})
if dups:
    sys.stderr.write("hapi-tick: duplicate tick name(s): " + ", ".join(dups) + "\n")
    sys.exit(1)
if name:
    matches = [w for w in ticks if w.get("name") == name]
    if not matches:
        sys.stderr.write(f"hapi-tick: unknown tick '{name}' in {path}\n")
        sys.exit(1)
    json.dump(matches[0], sys.stdout)
else:
    json.dump({"version": doc.get("version", 1), "ticks": ticks}, sys.stdout)
PY
        return
    fi
    local bun
    bun="$(resolve_bun)" || bun=""
    local root_mods="$REPO_ROOT/node_modules/yaml"
    local active_link="${HAPI_ACTIVE_LINK:-$HOME/coding/hapi/active}"
    local active_root=""
    if [[ -L "$active_link" || -d "$active_link" ]]; then
        active_root="$(readlink -f "$active_link")"
    fi
    if [[ -n "$bun" && -x "$bun" ]] && { [[ -d "$root_mods" ]] || [[ -d "$active_root/node_modules/yaml" ]]; }; then
        local cwd="$REPO_ROOT"
        [[ -d "$root_mods" ]] || cwd="$active_root"
        (
            cd "$cwd"
            "$bun" -e '
import { readFileSync } from "fs";
import YAML from "yaml";
const path = Bun.argv[1];
const name = Bun.argv[2] || "";
const doc = YAML.parse(readFileSync(path, "utf8")) || {};
const ticks = doc.ticks || [];
const names = ticks.map((w) => w && w.name).filter(Boolean);
const dups = [...new Set(names.filter((n) => names.filter((x) => x === n).length > 1))];
if (dups.length) {
  console.error("hapi-tick: duplicate tick name(s): " + dups.join(", "));
  process.exit(1);
}
if (name) {
  const hit = ticks.find((w) => w && w.name === name);
  if (!hit) {
    console.error("hapi-tick: unknown tick '\''" + name + "'\'' in " + path);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(hit));
} else {
  process.stdout.write(JSON.stringify({ version: doc.version ?? 1, ticks }));
}
' "$REGISTRY" "$name"
        )
        return
    fi
    die "YAML parser missing — install python3-yaml, or ensure bun + node_modules/yaml"
}

tick_field() {
    local json="$1" field="$2" default="${3:-}"
    printf '%s' "$json" | jq -r --arg d "$default" "
        ($field) as \$v |
        if \$v == null then \$d else \$v end
    "
}

unit_prefix() {
    local name="$1"
    printf 'hapi-tick-%s' "$name"
}

calendar_from_cadence() {
    local cadence="$1"
    if [[ "$cadence" == OnCalendar=* ]]; then
        printf '%s\n' "${cadence#OnCalendar=}"
    else
        printf '%s\n' "$cadence"
    fi
}

cmd_list() {
    [[ -f "$REGISTRY" ]] || die "registry missing: $REGISTRY"
    local payload
    payload="$(registry_json)"
    if [[ "$(printf '%s' "$payload" | jq '.ticks | length')" -eq 0 ]]; then
        echo "(no ticks)"
        return 0
    fi
    printf '%-28s %-16s %-14s %s\n' NAME HOST STRATEGY CADENCE
    printf '%s' "$payload" | jq -r '.ticks[] | [(.name // "?"), (.host // "?"), (.state.strategy // "?"), (.cadence // "?")] | @tsv' \
        | while IFS=$'\t' read -r n h s c; do
            printf '%-28s %-16s %-14s %s\n' "$n" "$h" "$s" "$c"
        done
}

cmd_templates() {
    echo "Templates in $TEMPLATES_DIR:"
    if [[ -d "$TEMPLATES_DIR" ]]; then
        find "$TEMPLATES_DIR" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' -o -name '*.md' \) \
            -printf '  %f\n' | sort
    else
        echo "  (none)"
    fi
}

validate_one() {
    local name="$1"
    local json script strategy state_path host on_change user warnings=0
    assert_tick_name "$name"
    json="$(registry_json "$name")"
    user="$(resolve_tick_user "$json")"
    # Elevate (interactive once) before cross-user -n checks so a missing
    # sudo cache is not misreported as an inaccessible probe/state/workdir.
    ensure_as_user_sudo "$user"
    script="$(tick_field "$json" '.probe.script')"
    strategy="$(tick_field "$json" '.state.strategy')"
    local raw_state_path
    raw_state_path="$(tick_field "$json" '.state.path')"
    [[ -n "$raw_state_path" && "$raw_state_path" != null ]] || die "$name: state.path required"
    # Expand ~/ against the service user (same as generate_units), not the caller.
    state_path="$(expand_user_path "$raw_state_path" "$user")"
    [[ -n "$state_path" ]] || die "$name: state.path expands to empty"
    host="$(tick_field "$json" '.host')"
    on_change="$(printf '%s' "$json" | jq -c '.on_change // []')"

    [[ -n "$script" && "$script" != null ]] || die "$name: probe.script required"
    [[ -n "$strategy" && "$strategy" != null ]] || die "$name: state.strategy required"
    case "$strategy" in
        max-id|seen-set|timestamp-ids|notified-ids) ;;
        *) die "$name: unknown state.strategy '$strategy'" ;;
    esac
    if [[ ! -f "$script" ]]; then
        die "$name: probe script not found: $script"
    fi
    if ! as_user_test "$user" -x "$script"; then
        die "$name: probe script not executable by user '$user': $script"
    fi

    local home_dir workdir lock state_parent lock_parent
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home_dir" ]] || die "$name: no home directory for user '$user'"
    lock="$(expand_user_path "$(tick_field "$json" '.lock.path' "")" "$user")"
    if [[ -z "$lock" ]]; then
        lock="$home_dir/.local/state/hapi/tick-${name}.lock"
    fi
    state_parent="$(dirname "$state_path")"
    lock_parent="$(dirname "$lock")"
    if [[ -d "$state_parent" ]]; then
        if ! as_user_test "$user" -w "$state_parent"; then
            die "$name: state parent not writable by user '$user': $state_parent"
        fi
    else
        if ! as_user_can_mkdir "$user" "$state_parent"; then
            die "$name: user '$user' cannot create state parent: $state_parent"
        fi
        err "$name: WARN state parent missing (will create on run): $state_parent"
        warnings=$((warnings + 1))
    fi
    if [[ -d "$lock_parent" ]]; then
        if ! as_user_test "$user" -w "$lock_parent"; then
            die "$name: lock parent not writable by user '$user': $lock_parent"
        fi
    else
        if ! as_user_can_mkdir "$user" "$lock_parent"; then
            die "$name: user '$user' cannot create lock parent: $lock_parent"
        fi
    fi

    # working_directory must exist and be usable by the service user (matches unit).
    workdir="$(tick_field "$json" '.working_directory' "$home_dir")"
    [[ -n "$workdir" && "$workdir" != null ]] || workdir="$home_dir"
    if [[ ! -d "$workdir" ]]; then
        die "$name: working_directory not found: $workdir"
    fi
    if ! as_user_test "$user" -x "$workdir"; then
        die "$name: working_directory not accessible by user '$user': $workdir"
    fi

    # Reject env values that would corrupt TSV/assignment serialization.
    registry_env_assignments "$json" "$name" >/dev/null

    # Token-cost lint: flag agent CLIs and HAPI wake commands in the probe path.
    local on_len
    on_len="$(printf '%s' "$on_change" | jq 'length')"
    local wakes_agent=0
    if grep -Eiq '^[[:space:]]*(exec[[:space:]]+)?(claude|cursor|codex)([[:space:]|&;]|$)' "$script" \
        || grep -Eiq '^[[:space:]]*[^#]*[/[:space:]](claude|cursor|codex)([[:space:]|&;]|$)' "$script" \
        || grep -Eiq '(^|[[:space:]/`"'\''])(hapi[[:space:]]+(spawn-peer|ping-peer)|hapi-spawn-peer|hapi-ping-peer)([[:space:]|&;]|$)' "$script"; then
        wakes_agent=1
    fi
    if [[ "$wakes_agent" -eq 1 ]]; then
        if [[ "$on_len" -eq 0 ]]; then
            err "$name: WARN probe invokes an agent wake (CLI / spawn-peer / ping-peer) and on_change is empty — mechanical polls must not burn tokens"
            warnings=$((warnings + 1))
        else
            err "$name: WARN probe invokes an agent wake in-tick — prefer moving agent wake to on_change only"
            warnings=$((warnings + 1))
        fi
    fi
    # Flag live CronCreate/ScheduleWakeup *invocations*, not historical comments.
    if grep -Eiq '^[[:space:]]*(claude[[:space:]]+.*)?(CronCreate|ScheduleWakeup)[[:space:](]' "$script"; then
        err "$name: WARN probe invokes CronCreate/ScheduleWakeup — wrong lane for mechanical polls"
        warnings=$((warnings + 1))
    fi

    local cadence cal delay
    cadence="$(tick_field "$json" '.cadence')"
    [[ -n "$cadence" && "$cadence" != null ]] || die "$name: cadence required (e.g. OnCalendar=*:8,38)"
    cal="$(calendar_from_cadence "$cadence")"
    [[ -n "$cal" ]] || die "$name: cadence produced empty OnCalendar value"
    delay="$(tick_field "$json" '.randomized_delay_sec' '90')"
    [[ -n "$delay" && "$delay" != null ]] || die "$name: randomized_delay_sec required"
    if command -v systemd-analyze >/dev/null 2>&1; then
        local tmp_timer
        tmp_timer="$(mktemp --suffix=.timer)"
        printf '[Timer]\nOnCalendar=%s\n' "$cal" >"$tmp_timer"
        if ! systemd-analyze verify "$tmp_timer" >/dev/null 2>&1; then
            rm -f "$tmp_timer"
            die "$name: cadence not accepted by systemd-analyze: $cadence"
        fi
        rm -f "$tmp_timer"
        if ! systemd-analyze timespan "$delay" >/dev/null 2>&1; then
            die "$name: randomized_delay_sec not accepted by systemd-analyze timespan: $delay"
        fi
    fi

    [[ -n "$host" && "$host" != null ]] || die "$name: host required (per-machine install guard)"
    local here
    here="$(hostname_short)"
    if [[ "$host" != "$here" && "$host" != "$(hostname)" ]]; then
        err "$name: NOTE registry host='$host' but this machine is '$here' (install will warn unless --force)"
    fi

    echo "hapi-tick: validate ok — $name (warnings=$warnings)"
    return 0
}

cmd_validate() {
    local name="${1:-}"
    [[ -f "$REGISTRY" ]] || die "registry missing: $REGISTRY"
    if [[ -n "$name" ]]; then
        validate_one "$name"
        return 0
    fi
    local names
    names="$(registry_json | jq -r '.ticks[].name')"
    local n
    for n in $names; do
        validate_one "$n"
    done
}

generate_units() {
    local name="$1"
    local json prefix script calendar delay user workdir lock state_path desc doc_registry home_dir
    assert_tick_name "$name"
    json="$(registry_json "$name")"
    prefix="$(unit_prefix "$name")"
    script="$(tick_field "$json" '.probe.script')"
    calendar="$(calendar_from_cadence "$(tick_field "$json" '.cadence')")"
    delay="$(tick_field "$json" '.randomized_delay_sec' '90')"
    user="$(resolve_tick_user "$json")"
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home_dir" ]] || die "$name: no home directory for user '$user'"
    workdir="$(tick_field "$json" '.working_directory' "$home_dir")"
    lock="$(expand_user_path "$(tick_field "$json" '.lock.path' "")" "$user")"
    if [[ -z "$lock" ]]; then
        lock="$home_dir/.local/state/hapi/tick-${name}.lock"
    fi
    state_path="$(expand_user_path "$(tick_field "$json" '.state.path')" "$user")"
    desc="$(tick_field "$json" '.description' "HAPI tick: $name")"
    # Prefer the primary-mirror registry path in unit Documentation= when generating
    # from a worktree (install paths in ticks.yaml already point at runtime scripts).
    doc_registry="$REGISTRY"
    if [[ "$REPO_ROOT" == */worktrees/* ]]; then
        doc_registry="${HAPI_MIRROR_ROOT:-$HOME/coding/hapi}/config/ticks.yaml"
    fi

    mkdir -p "$UNIT_OUT_DIR"

    local service_file="$UNIT_OUT_DIR/${prefix}.service"
    local timer_file="$UNIT_OUT_DIR/${prefix}.timer"
    local lock_q script_q lock_dir_q state_dir_q
    lock_q="$(systemd_quote_arg "$lock")"
    script_q="$(systemd_quote_arg "$script")"
    lock_dir_q="$(systemd_quote_arg "$(dirname "$lock")")"
    state_dir_q="$(systemd_quote_arg "$(dirname "$state_path")")"

    {
        echo "# Generated by hapi-tick from $REGISTRY"
        echo "# Do not hand-edit; re-run: hapi tick install $name"
        echo
        echo "[Unit]"
        echo "Description=$desc"
        echo "Documentation=file://$doc_registry"
        echo "After=network-online.target"
        echo "Wants=network-online.target"
        echo "ConditionPathExists=$(systemd_escape_condition_path "$script")"
        local cond
        while IFS= read -r cond; do
            [[ -n "$cond" && "$cond" != null ]] || continue
            echo "ConditionPathExists=$(systemd_escape_condition_path "$cond")"
        done < <(printf '%s' "$json" | jq -r '.conditions[]? // empty')

        echo
        echo "[Service]"
        echo "Type=oneshot"
        echo "User=$user"
        # Omit Group= — systemd uses the account primary group (may differ from username).
        echo "Nice=10"
        echo "Environment=HOME=$home_dir"
        echo "Environment=USER=$user"
        echo "Environment=PATH=$home_dir/.local/bin:/usr/local/bin:/usr/bin:/bin"
        local assignment key val
        while IFS= read -r assignment; do
            [[ -n "$assignment" ]] || continue
            key="${assignment%%=*}"
            val="${assignment#*=}"
            # Quote full KEY=value so whitespace survives systemd parsing.
            # Escape % as %% so systemd does not expand / drop specifier sequences.
            val="${val//\\/\\\\}"
            val="${val//\"/\\\"}"
            val="${val//%/%%}"
            echo "Environment=\"$key=$val\""
        done < <(registry_env_assignments "$json" "$name")
        echo "WorkingDirectory=$workdir"
        echo "ExecStartPre=/usr/bin/mkdir -p $lock_dir_q $state_dir_q"
        echo "ExecStart=/usr/bin/flock -w 60 $lock_q $script_q"
        echo "StandardOutput=journal"
        echo "StandardError=journal"
        echo "SyslogIdentifier=$prefix"
    } > "$service_file"

    {
        echo "# Generated by hapi-tick from $REGISTRY"
        echo "# Do not hand-edit; re-run: hapi tick install $name"
        echo
        echo "[Unit]"
        echo "Description=$desc (timer)"
        echo "Documentation=file://$doc_registry"
        echo
        echo "[Timer]"
        echo "OnCalendar=$calendar"
        echo "RandomizedDelaySec=$delay"
        echo "AccuracySec=1min"
        echo "Persistent=true"
        echo "Unit=${prefix}.service"
        echo
        echo "[Install]"
        echo "WantedBy=timers.target"
    } > "$timer_file"

    echo "$service_file"
    echo "$timer_file"
}

cmd_install() {
    local name="" force=0 run_now=0 dry=0 skip_generate=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --force) force=1 ;;
            --run-now) run_now=1 ;;
            --dry-run) dry=1 ;;
            --skip-generate) skip_generate=1 ;;
            -h|--help) usage; return 0 ;;
            -*) die "unknown flag: $1" ;;
            *)
                [[ -z "$name" ]] || die "unexpected arg: $1"
                name="$1"
                ;;
        esac
        shift
    done
    [[ -n "$name" ]] || die "usage: hapi tick install <name> [--force] [--run-now] [--dry-run]"

    validate_one "$name" >/dev/null

    local json host here
    json="$(registry_json "$name")"
    host="$(tick_field "$json" '.host')"
    here="$(hostname_short)"
    if [[ -n "$host" && "$host" != "$here" && "$host" != "$(hostname)" && "$force" -ne 1 ]]; then
        die "registry host='$host' != this machine '$here' (pass --force to install anyway)"
    fi

    local files
    # Generate git-tracked units as the invoking user so sudo never leaves
    # root-owned files in the checkout.
    if [[ "$skip_generate" -ne 1 ]]; then
        files="$(generate_units "$name")"
        echo "hapi-tick: generated:"
        echo "$files" | sed 's/^/  /'
    else
        echo "hapi-tick: using pre-generated units in $UNIT_OUT_DIR"
    fi

    if [[ "$dry" -eq 1 ]]; then
        echo "hapi-tick: dry-run — not installing to /etc/systemd/system"
        return 0
    fi

    if [[ "$(id -u)" -ne 0 ]]; then
        err "re-executing under sudo to install systemd units…"
        local -a sudo_args=(sudo -E -- "$0" install "$name" --skip-generate)
        [[ "$force" -eq 1 ]] && sudo_args+=(--force)
        [[ "$run_now" -eq 1 ]] && sudo_args+=(--run-now)
        exec "${sudo_args[@]}"
    fi

    local prefix svc timer
    prefix="$(unit_prefix "$name")"
    svc="$UNIT_OUT_DIR/${prefix}.service"
    timer="$UNIT_OUT_DIR/${prefix}.timer"
    install -m 0644 "$svc" "/etc/systemd/system/${prefix}.service"
    install -m 0644 "$timer" "/etc/systemd/system/${prefix}.timer"
    systemctl daemon-reload
    systemctl enable --now "${prefix}.timer"
    echo "hapi-tick: installed ${prefix}.timer"
    systemctl list-timers "${prefix}*" --all --no-pager || true

    if [[ "$run_now" -eq 1 ]]; then
        echo "hapi-tick: starting one tick now…"
        systemctl start "${prefix}.service"
        systemctl --no-pager --full status "${prefix}.service" | head -40 || true
    fi
}

cmd_uninstall() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "usage: hapi tick uninstall <name>"
    local prefix
    prefix="$(unit_prefix "$name")"
    if [[ "$(id -u)" -ne 0 ]]; then
        exec sudo -E -- "$0" uninstall "$name"
    fi
    # Disable/stop timer first so it cannot fire while we tear down the oneshot.
    systemctl disable --now "${prefix}.timer" 2>/dev/null || true
    systemctl stop "${prefix}.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/${prefix}.service" "/etc/systemd/system/${prefix}.timer"
    systemctl daemon-reload
    echo "hapi-tick: uninstalled $prefix"
}

cmd_run() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "usage: hapi tick run <name>"
    validate_one "$name" >/dev/null
    local json script lock workdir user home_dir state_path unit_path bun_exe
    json="$(registry_json "$name")"
    script="$(tick_field "$json" '.probe.script')"
    user="$(resolve_tick_user "$json")"
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home_dir" ]] || die "no home directory for user '$user'"
    unit_path="$home_dir/.local/bin:/usr/local/bin:/usr/bin:/bin"
    # Resolve Bun from the caller's PATH before the clean-env re-exec so
    # mise/asdf installs survive the fixed unit PATH.
    bun_exe=""
    bun_exe="$(resolve_bun)" || bun_exe="${BUN:-}"
    # Match the installed service: drop to registry user with a clean env
    # (do not preserve caller secrets/PATH via sudo -E). Compare by UID so
    # numeric .user values do not re-exec forever.
    if ! same_tick_user "$user"; then
        err "re-executing as user '$user' (caller was '$(id -un)' uid=$(id -u))…"
        local -a reexec_env=(
            "HOME=$home_dir"
            "USER=$user"
            "PATH=$unit_path"
            "LANG=${LANG:-C.UTF-8}"
        )
        [[ -n "${HAPI_TICKS_YAML:-}" ]] && reexec_env+=("HAPI_TICKS_YAML=$HAPI_TICKS_YAML")
        [[ -n "${HAPI_MIRROR_ROOT:-}" ]] && reexec_env+=("HAPI_MIRROR_ROOT=$HAPI_MIRROR_ROOT")
        [[ -n "${HAPI_ACTIVE_LINK:-}" ]] && reexec_env+=("HAPI_ACTIVE_LINK=$HAPI_ACTIVE_LINK")
        [[ -n "$bun_exe" ]] && reexec_env+=("BUN=$bun_exe")
        exec sudo -u "$user" -H -- env -i "${reexec_env[@]}" "$(readlink -f "$0")" run "$name"
    fi

    # Match systemd ConditionPathExists: skip (exit 0) when probe/conditions absent.
    if [[ ! -e "$script" ]]; then
        err "skipping $name — ConditionPathExists failed: $script"
        return 0
    fi
    local cond
    while IFS= read -r cond; do
        [[ -n "$cond" && "$cond" != null ]] || continue
        if [[ ! -e "$cond" ]]; then
            err "skipping $name — ConditionPathExists failed: $cond"
            return 0
        fi
    done < <(printf '%s' "$json" | jq -r '.conditions[]? // empty')

    workdir="$(tick_field "$json" '.working_directory' "$home_dir")"
    lock="$(expand_user_path "$(tick_field "$json" '.lock.path' "")" "$user")"
    if [[ -z "$lock" ]]; then
        lock="$home_dir/.local/state/hapi/tick-${name}.lock"
    fi
    state_path="$(expand_user_path "$(tick_field "$json" '.state.path')" "$user")"
    # Match ExecStartPre: create both lock and state parents before the probe.
    mkdir -p "$(dirname "$lock")" "$(dirname "$state_path")"
    if [[ -z "$workdir" || "$workdir" == null ]]; then
        workdir="$home_dir"
    fi
    if [[ ! -d "$workdir" ]]; then
        die "working_directory not found: $workdir"
    fi
    cd "$workdir" || die "cannot cd to working_directory: $workdir"

    # Clean environment matching the generated unit (HOME/USER/PATH + registry env).
    local -a probe_env=(
        "HOME=$home_dir"
        "USER=$user"
        "PATH=$unit_path"
        "LANG=${LANG:-C.UTF-8}"
    )
    local assignment
    while IFS= read -r assignment; do
        [[ -n "$assignment" ]] || continue
        probe_env+=("$assignment")
    done < <(registry_env_assignments "$json" "$name")

    echo "hapi-tick: running $script (flock $lock)"
    env -i "${probe_env[@]}" /usr/bin/flock -w 60 "$lock" "$script"
}

doctor_one() {
    local name="$1"
    local json prefix script state_path strategy host user healthy=1
    json="$(registry_json "$name")"
    user="$(resolve_tick_user "$json")"
    prefix="$(unit_prefix "$name")"
    script="$(tick_field "$json" '.probe.script')"
    state_path="$(expand_user_path "$(tick_field "$json" '.state.path')" "$user")"
    strategy="$(tick_field "$json" '.state.strategy')"
    host="$(tick_field "$json" '.host')"

    echo "=== $name ==="
    echo "host(registry): $host  this: $(hostname_short)"
    echo "user: $user"
    if [[ -f "$script" ]]; then
        echo "probe: $script  exists=yes"
    else
        echo "probe: $script  exists=NO"
        healthy=0
    fi
    # Every ConditionPathExists (probe + registry conditions) — missing paths
    # skip the oneshot without failing the unit, so doctor must catch them.
    local cond
    while IFS= read -r cond; do
        [[ -n "$cond" && "$cond" != null ]] || continue
        if [[ -e "$cond" ]]; then
            echo "condition: $cond  exists=yes"
        else
            echo "condition: $cond  exists=NO"
            healthy=0
        fi
    done < <(printf '%s' "$json" | jq -r '.conditions[]? // empty')
    echo "state($strategy): $state_path"

    if [[ -f "$state_path" ]]; then
        case "$strategy" in
            max-id)
                echo "  lastMaxId=$(hapi_tick_max_id_read "$state_path")  mtime=$(date -u -r "$state_path" +%FT%TZ 2>/dev/null || stat -c %y "$state_path")"
                ;;
            seen-set)
                echo "  seen_count=$(wc -l < "$state_path" | tr -d ' ')  mtime=$(date -u -r "$state_path" +%FT%TZ 2>/dev/null || true)"
                ;;
            timestamp-ids)
                echo "  $(hapi_tick_timestamp_ids_read "$state_path")"
                ;;
            *)
                ls -l "$state_path" || true
                ;;
        esac
    else
        echo "  (state file missing)"
    fi

    if systemctl cat "${prefix}.timer" >/dev/null 2>&1; then
        local enabled active svc_failed svc_loaded
        enabled="$(systemctl is-enabled "${prefix}.timer" 2>/dev/null || echo unknown)"
        active="$(systemctl is-active "${prefix}.timer" 2>/dev/null || echo unknown)"
        svc_failed="$(systemctl is-failed "${prefix}.service" 2>/dev/null || true)"
        svc_failed="${svc_failed:-unknown}"
        if systemctl cat "${prefix}.service" >/dev/null 2>&1; then
            svc_loaded=yes
        else
            svc_loaded=NO
            healthy=0
        fi
        echo "timer: ${prefix}.timer  enabled=$enabled  active=$active"
        echo "service: ${prefix}.service  loaded=$svc_loaded  is-failed=$svc_failed"
        systemctl list-timers "${prefix}.timer" --all --no-pager 2>/dev/null | tail -n +1 | head -5 || true
        echo "recent journal:"
        journalctl -u "${prefix}.service" -n 5 --no-pager 2>/dev/null | sed 's/^/  /' || echo "  (no journal)"
        if [[ "$enabled" != "enabled" || "$active" != "active" ]]; then
            healthy=0
        fi
        # is-failed only reports "failed"; unknown/missing is not healthy either.
        if [[ "$svc_failed" == "failed" || "$svc_failed" == "unknown" ]]; then
            healthy=0
        fi
        # Detect registry vs installed-unit drift (operator changed yaml without reinstall).
        local drift_dir expected_svc expected_timer
        drift_dir="$(mktemp -d)"
        local saved_out="$UNIT_OUT_DIR"
        UNIT_OUT_DIR="$drift_dir"
        generate_units "$name" >/dev/null
        UNIT_OUT_DIR="$saved_out"
        expected_svc="$drift_dir/${prefix}.service"
        expected_timer="$drift_dir/${prefix}.timer"
        local installed_svc_norm expected_svc_norm
        installed_svc_norm="$(systemctl cat "${prefix}.service" 2>/dev/null | grep -E '^(User|Environment|WorkingDirectory|ExecStart|ExecStartPre|ConditionPathExists)=' | sort || true)"
        expected_svc_norm="$(grep -E '^(User|Environment|WorkingDirectory|ExecStart|ExecStartPre|ConditionPathExists)=' "$expected_svc" | sort || true)"
        if [[ "$installed_svc_norm" != "$expected_svc_norm" ]]; then
            echo "drift: installed ${prefix}.service differs from registry — re-run: hapi tick install $name"
            healthy=0
        fi
        local installed_timer_norm expected_timer_norm
        installed_timer_norm="$(systemctl cat "${prefix}.timer" 2>/dev/null | grep -E '^(OnCalendar|RandomizedDelaySec|Unit)=' | sort || true)"
        expected_timer_norm="$(grep -E '^(OnCalendar|RandomizedDelaySec|Unit)=' "$expected_timer" | sort || true)"
        if [[ "$installed_timer_norm" != "$expected_timer_norm" ]]; then
            echo "drift: installed ${prefix}.timer differs from registry — re-run: hapi tick install $name"
            healthy=0
        fi
        rm -rf "$drift_dir"
    else
        echo "timer: ${prefix}.timer  NOT INSTALLED"
        # Legacy units (pre-migration) — informative only.
        case "$name" in
            overseer-inbox)
                if systemctl cat hapi-overseer-watch.timer >/dev/null 2>&1; then
                    echo "legacy: hapi-overseer-watch.timer still present (belt-and-braces OK until cutover)"
                    systemctl is-enabled hapi-overseer-watch.timer 2>/dev/null || true
                fi
                ;;
            producer-issue-poll)
                if systemctl cat hapi-producer-issue-poll.timer >/dev/null 2>&1; then
                    echo "legacy: hapi-producer-issue-poll.timer still present (belt-and-braces OK until cutover)"
                fi
                ;;
        esac
        healthy=0
    fi

    if [[ "$healthy" -eq 1 ]]; then
        echo "doctor: HEALTHY"
    else
        echo "doctor: NEEDS ATTENTION"
        return 1
    fi
}

cmd_doctor() {
    local name="${1:-}" rc=0
    if [[ -n "$name" ]]; then
        doctor_one "$name" || rc=1
        return $rc
    fi
    local n here host
    here="$(hostname_short)"
    for n in $(registry_json | jq -r '.ticks[].name'); do
        host="$(tick_field "$(registry_json "$n")" '.host')"
        # Aggregate doctor is host-local; remote ticks stay inspectable by name.
        if [[ -n "$host" && "$host" != null && "$host" != "$here" && "$host" != "$(hostname)" ]]; then
            echo "=== $n ==="
            echo "host(registry): $host  this: $here — skipped (other host)"
            echo
            continue
        fi
        doctor_one "$n" || rc=1
        echo
    done
    return $rc
}

main() {
    local cmd="${1:-}"
    shift || true
    case "$cmd" in
        list) cmd_list "$@" ;;
        validate) cmd_validate "$@" ;;
        install) cmd_install "$@" ;;
        uninstall) cmd_uninstall "$@" ;;
        run) cmd_run "$@" ;;
        doctor) cmd_doctor "$@" ;;
        templates) cmd_templates "$@" ;;
        -h|--help|help|"") usage ;;
        *)
            die "unknown subcommand '$cmd' (try: list validate install uninstall run doctor templates)"
            ;;
    esac
}

main "$@"
