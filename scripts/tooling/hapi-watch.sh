#!/usr/bin/env bash
# hapi-watch — declarative registry + systemd generator for bare (zero-token) pollers.
#
# Canon: docs/plans/2026-09-18-scheduled-agent-tasks-design.md
# Runbook: docs/tooling/hapi-watch.md
#
# Mechanical polls stay in bare scripts. This tool does NOT route through CronCreate
# or a hub cron table. Agents wake only via on_change (ntfy / spawn_peer / ping_peer)
# inside those probe scripts.
#
# Usage:
#   hapi watch list
#   hapi watch validate [name]
#   hapi watch install <name> [--force] [--run-now] [--dry-run]
#   hapi watch uninstall <name>
#   hapi watch run <name>
#   hapi watch doctor [name]
#   hapi watch templates
#
# Also: hapi-watch <subcommand> …  (PATH wrapper)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="${HAPI_WATCHES_YAML:-$REPO_ROOT/config/watches.yaml}"
TEMPLATES_DIR="$SCRIPT_DIR/watch-templates"
UNIT_OUT_DIR="$SCRIPT_DIR/systemd/watches"
WATERMARK_LIB="$SCRIPT_DIR/lib/hapi-watch-watermark.sh"

# shellcheck source=lib/hapi-watch-watermark.sh
source "$WATERMARK_LIB"

err() { echo "hapi-watch: $*" >&2; }
die() { err "$*"; exit 2; }

usage() {
    sed -n '2,22p' "$0"
}

# Expand ~ in a path string (also used inside generated units as literal $HOME paths).
expand_user_path() {
    hapi_watch_expand_path "$1"
}

hostname_short() {
    hostname -s 2>/dev/null || hostname
}

# Emit JSON for one watch (or all) via python+yaml.
registry_json() {
    local name="${1:-}"
    python3 - "$REGISTRY" "$name" <<'PY'
import json, sys, os
path, name = sys.argv[1], sys.argv[2]
try:
    import yaml
except ImportError:
    sys.stderr.write("hapi-watch: PyYAML required (python3 -c 'import yaml')\n")
    sys.exit(3)
with open(path) as f:
    doc = yaml.safe_load(f) or {}
watches = doc.get("watches") or []
if name:
    matches = [w for w in watches if w.get("name") == name]
    if not matches:
        sys.stderr.write(f"hapi-watch: unknown watch '{name}' in {path}\n")
        sys.exit(1)
    json.dump(matches[0], sys.stdout)
else:
    json.dump({"version": doc.get("version", 1), "watches": watches}, sys.stdout)
PY
}

watch_field() {
    local json="$1" field="$2" default="${3:-}"
    printf '%s' "$json" | jq -r --arg d "$default" "
        ($field) as \$v |
        if \$v == null then \$d else \$v end
    "
}

unit_prefix() {
    local name="$1"
    printf 'hapi-watch-%s' "$name"
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
    python3 - "$REGISTRY" <<'PY'
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1])) or {}
watches = doc.get("watches") or []
if not watches:
    print("(no watches)")
    raise SystemExit(0)
print(f"{'NAME':<28} {'HOST':<16} {'STRATEGY':<14} CADENCE")
for w in watches:
    st = (w.get("state") or {}).get("strategy", "?")
    print(f"{w.get('name','?'):<28} {w.get('host','?'):<16} {st:<14} {w.get('cadence','?')}")
PY
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
    local json script strategy state_path host on_change warnings=0
    json="$(registry_json "$name")"
    script="$(watch_field "$json" '.probe.script')"
    strategy="$(watch_field "$json" '.state.strategy')"
    state_path="$(expand_user_path "$(watch_field "$json" '.state.path')")"
    host="$(watch_field "$json" '.host')"
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
    if [[ ! -x "$script" ]]; then
        err "$name: WARN probe script not executable: $script"
        warnings=$((warnings + 1))
    fi
    local parent
    parent="$(dirname "$state_path")"
    if [[ ! -d "$parent" ]]; then
        err "$name: WARN state parent missing (will create on run): $parent"
        warnings=$((warnings + 1))
    elif [[ ! -w "$parent" ]]; then
        die "$name: state parent not writable: $parent"
    fi

    # Token-cost lint: flag agent CLIs in the probe path when on_change is empty.
    local on_len
    on_len="$(printf '%s' "$on_change" | jq 'length')"
    if grep -Eiq '(^|[^[:alnum:]_-])(claude|cursor|codex)([^[:alnum:]_-]|$)' "$script" \
        && ! grep -Eiq 'spawn-peer|spawn_peer|ping-peer|ping_peer|ntfy' "$script"; then
        if [[ "$on_len" -eq 0 ]]; then
            err "$name: WARN probe mentions an agent CLI and on_change is empty — mechanical polls must not burn tokens"
            warnings=$((warnings + 1))
        fi
    fi
    # Flag live CronCreate/ScheduleWakeup *invocations*, not historical comments.
    if grep -Eiq '^[[:space:]]*(claude[[:space:]]+.*)?(CronCreate|ScheduleWakeup)[[:space:](]' "$script"; then
        err "$name: WARN probe invokes CronCreate/ScheduleWakeup — wrong lane for mechanical polls"
        warnings=$((warnings + 1))
    fi

    local here
    here="$(hostname_short)"
    if [[ -n "$host" && "$host" != "$here" && "$host" != "$(hostname)" ]]; then
        err "$name: NOTE registry host='$host' but this machine is '$here' (install will warn unless --force)"
    fi

    echo "hapi-watch: validate ok — $name (warnings=$warnings)"
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
    names="$(registry_json | jq -r '.watches[].name')"
    local n
    for n in $names; do
        validate_one "$n"
    done
}

generate_units() {
    local name="$1"
    local json prefix script calendar delay user workdir lock state_path desc doc_registry
    json="$(registry_json "$name")"
    prefix="$(unit_prefix "$name")"
    script="$(watch_field "$json" '.probe.script')"
    calendar="$(calendar_from_cadence "$(watch_field "$json" '.cadence')")"
    delay="$(watch_field "$json" '.randomized_delay_sec' '90')"
    user="$(watch_field "$json" '.user' "${USER:-heavygee}")"
    workdir="$(watch_field "$json" '.working_directory' "/home/$user")"
    lock="$(expand_user_path "$(watch_field "$json" '.lock.path' "")")"
    if [[ -z "$lock" ]]; then
        lock="/home/$user/.local/state/hapi/watch-${name}.lock"
    fi
    state_path="$(expand_user_path "$(watch_field "$json" '.state.path')")"
    desc="$(watch_field "$json" '.description' "HAPI watch: $name")"
    # Prefer the primary-mirror registry path in unit Documentation= when generating
    # from a worktree (install paths in watches.yaml already point at runtime scripts).
    doc_registry="$REGISTRY"
    if [[ "$REPO_ROOT" == */worktrees/* ]]; then
        doc_registry="${HAPI_MIRROR_ROOT:-$HOME/coding/hapi}/config/watches.yaml"
    fi

    mkdir -p "$UNIT_OUT_DIR"

    local service_file="$UNIT_OUT_DIR/${prefix}.service"
    local timer_file="$UNIT_OUT_DIR/${prefix}.timer"
    local home_dir
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home_dir" ]] || home_dir="/home/$user"

    {
        echo "# Generated by hapi-watch from $REGISTRY"
        echo "# Do not hand-edit; re-run: hapi watch install $name"
        echo
        echo "[Unit]"
        echo "Description=$desc"
        echo "Documentation=file://$doc_registry"
        echo "After=network-online.target"
        echo "Wants=network-online.target"
        echo "ConditionPathExists=$script"
        local cond
        while IFS= read -r cond; do
            [[ -n "$cond" && "$cond" != null ]] || continue
            echo "ConditionPathExists=$cond"
        done < <(printf '%s' "$json" | jq -r '.conditions[]? // empty')

        echo
        echo "[Service]"
        echo "Type=oneshot"
        echo "User=$user"
        echo "Group=$user"
        echo "Nice=10"
        echo "Environment=HOME=$home_dir"
        echo "Environment=USER=$user"
        echo "Environment=PATH=$home_dir/.local/bin:/usr/local/bin:/usr/bin:/bin"
        local key val
        while IFS=$'\t' read -r key val; do
            [[ -n "$key" ]] || continue
            # Escape nothing exotic; values are operator-authored registry strings.
            echo "Environment=$key=$val"
        done < <(printf '%s' "$json" | jq -r '.env // {} | to_entries[] | "\(.key)\t\(.value)"')
        echo "WorkingDirectory=$workdir"
        echo "ExecStartPre=/usr/bin/mkdir -p $(dirname "$lock") $(dirname "$state_path")"
        echo "ExecStart=/usr/bin/flock -w 60 $lock $script"
        echo "StandardOutput=journal"
        echo "StandardError=journal"
        echo "SyslogIdentifier=$prefix"
    } > "$service_file"

    {
        echo "# Generated by hapi-watch from $REGISTRY"
        echo "# Do not hand-edit; re-run: hapi watch install $name"
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
    local name="" force=0 run_now=0 dry=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --force) force=1 ;;
            --run-now) run_now=1 ;;
            --dry-run) dry=1 ;;
            -h|--help) usage; return 0 ;;
            -*) die "unknown flag: $1" ;;
            *)
                [[ -z "$name" ]] || die "unexpected arg: $1"
                name="$1"
                ;;
        esac
        shift
    done
    [[ -n "$name" ]] || die "usage: hapi watch install <name> [--force] [--run-now] [--dry-run]"

    validate_one "$name" >/dev/null

    local json host here
    json="$(registry_json "$name")"
    host="$(watch_field "$json" '.host')"
    here="$(hostname_short)"
    if [[ -n "$host" && "$host" != "$here" && "$host" != "$(hostname)" && "$force" -ne 1 ]]; then
        die "registry host='$host' != this machine '$here' (pass --force to install anyway)"
    fi

    local files
    files="$(generate_units "$name")"
    echo "hapi-watch: generated:"
    echo "$files" | sed 's/^/  /'

    if [[ "$dry" -eq 1 ]]; then
        echo "hapi-watch: dry-run — not installing to /etc/systemd/system"
        return 0
    fi

    if [[ "$(id -u)" -ne 0 ]]; then
        err "re-executing under sudo to install systemd units…"
        exec sudo -E -- "$0" install "$name" \
            ${force:+--force} ${run_now:+--run-now}
    fi

    local prefix svc timer
    prefix="$(unit_prefix "$name")"
    svc="$UNIT_OUT_DIR/${prefix}.service"
    timer="$UNIT_OUT_DIR/${prefix}.timer"
    install -m 0644 "$svc" "/etc/systemd/system/${prefix}.service"
    install -m 0644 "$timer" "/etc/systemd/system/${prefix}.timer"
    systemctl daemon-reload
    systemctl enable --now "${prefix}.timer"
    echo "hapi-watch: installed ${prefix}.timer"
    systemctl list-timers "${prefix}*" --all --no-pager || true

    if [[ "$run_now" -eq 1 ]]; then
        echo "hapi-watch: starting one tick now…"
        systemctl start "${prefix}.service"
        systemctl --no-pager --full status "${prefix}.service" | head -40 || true
    fi
}

cmd_uninstall() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "usage: hapi watch uninstall <name>"
    local prefix
    prefix="$(unit_prefix "$name")"
    if [[ "$(id -u)" -ne 0 ]]; then
        exec sudo -E -- "$0" uninstall "$name"
    fi
    systemctl disable --now "${prefix}.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/${prefix}.service" "/etc/systemd/system/${prefix}.timer"
    systemctl daemon-reload
    echo "hapi-watch: uninstalled $prefix"
}

cmd_run() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "usage: hapi watch run <name>"
    validate_one "$name" >/dev/null
    local json script lock
    json="$(registry_json "$name")"
    script="$(watch_field "$json" '.probe.script')"
    lock="$(expand_user_path "$(watch_field "$json" '.lock.path' "")")"
    if [[ -z "$lock" ]]; then
        lock="$(expand_user_path ~/.local/state/hapi/watch-${name}.lock)"
    fi
    mkdir -p "$(dirname "$lock")"
    echo "hapi-watch: running $script (flock $lock)"
    /usr/bin/flock -w 60 "$lock" "$script"
}

doctor_one() {
    local name="$1"
    local json prefix script state_path strategy host
    json="$(registry_json "$name")"
    prefix="$(unit_prefix "$name")"
    script="$(watch_field "$json" '.probe.script')"
    state_path="$(expand_user_path "$(watch_field "$json" '.state.path')")"
    strategy="$(watch_field "$json" '.state.strategy')"
    host="$(watch_field "$json" '.host')"

    echo "=== $name ==="
    echo "host(registry): $host  this: $(hostname_short)"
    echo "probe: $script  exists=$([[ -f $script ]] && echo yes || echo NO)"
    echo "state($strategy): $state_path"

    if [[ -f "$state_path" ]]; then
        case "$strategy" in
            max-id)
                echo "  lastMaxId=$(hapi_watch_max_id_read "$state_path")  mtime=$(date -u -r "$state_path" +%FT%TZ 2>/dev/null || stat -c %y "$state_path")"
                ;;
            seen-set)
                echo "  seen_count=$(wc -l < "$state_path" | tr -d ' ')  mtime=$(date -u -r "$state_path" +%FT%TZ 2>/dev/null || true)"
                ;;
            timestamp-ids)
                echo "  $(hapi_watch_timestamp_ids_read "$state_path")"
                ;;
            *)
                ls -l "$state_path" || true
                ;;
        esac
    else
        echo "  (state file missing)"
    fi

    local healthy=1
    if systemctl cat "${prefix}.timer" >/dev/null 2>&1; then
        local enabled active
        enabled="$(systemctl is-enabled "${prefix}.timer" 2>/dev/null || echo unknown)"
        active="$(systemctl is-active "${prefix}.timer" 2>/dev/null || echo unknown)"
        echo "timer: ${prefix}.timer  enabled=$enabled  active=$active"
        systemctl list-timers "${prefix}.timer" --all --no-pager 2>/dev/null | tail -n +1 | head -5 || true
        echo "recent journal:"
        journalctl -u "${prefix}.service" -n 5 --no-pager 2>/dev/null | sed 's/^/  /' || echo "  (no journal)"
        if [[ "$enabled" != "enabled" || "$active" != "active" ]]; then
            healthy=0
        fi
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
    local n
    for n in $(registry_json | jq -r '.watches[].name'); do
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
