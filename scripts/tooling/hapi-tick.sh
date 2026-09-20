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
    local bun="${BUN:-$HOME/.bun/bin/bun}"
    local root_mods="$REPO_ROOT/node_modules/yaml"
    local active_link="${HAPI_ACTIVE_LINK:-$HOME/coding/hapi/active}"
    local active_root=""
    if [[ -L "$active_link" || -d "$active_link" ]]; then
        active_root="$(readlink -f "$active_link")"
    fi
    if [[ -x "$bun" ]] && { [[ -d "$root_mods" ]] || [[ -d "$active_root/node_modules/yaml" ]]; }; then
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
    local json script strategy state_path host on_change warnings=0
    json="$(registry_json "$name")"
    script="$(tick_field "$json" '.probe.script')"
    strategy="$(tick_field "$json" '.state.strategy')"
    state_path="$(expand_user_path "$(tick_field "$json" '.state.path')")"
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
    if [[ ! -x "$script" ]]; then
        die "$name: probe script not executable: $script"
    fi
    local parent
    parent="$(dirname "$state_path")"
    if [[ ! -d "$parent" ]]; then
        err "$name: WARN state parent missing (will create on run): $parent"
        warnings=$((warnings + 1))
    elif [[ ! -w "$parent" ]]; then
        die "$name: state parent not writable: $parent"
    fi

    # Token-cost lint: flag agent CLI invocations regardless of escalation terms elsewhere.
    local on_len
    on_len="$(printf '%s' "$on_change" | jq 'length')"
    if grep -Eiq '^[[:space:]]*(exec[[:space:]]+)?(claude|cursor|codex)([[:space:]|&;]|$)' "$script" \
        || grep -Eiq '^[[:space:]]*[^#]*[/[:space:]](claude|cursor|codex)([[:space:]|&;]|$)' "$script"; then
        if [[ "$on_len" -eq 0 ]]; then
            err "$name: WARN probe invokes an agent CLI and on_change is empty — mechanical polls must not burn tokens"
            warnings=$((warnings + 1))
        else
            err "$name: WARN probe invokes an agent CLI in-tick — prefer moving agent wake to on_change only"
            warnings=$((warnings + 1))
        fi
    fi
    # Flag live CronCreate/ScheduleWakeup *invocations*, not historical comments.
    if grep -Eiq '^[[:space:]]*(claude[[:space:]]+.*)?(CronCreate|ScheduleWakeup)[[:space:](]' "$script"; then
        err "$name: WARN probe invokes CronCreate/ScheduleWakeup — wrong lane for mechanical polls"
        warnings=$((warnings + 1))
    fi

    local cadence cal
    cadence="$(tick_field "$json" '.cadence')"
    [[ -n "$cadence" && "$cadence" != null ]] || die "$name: cadence required (e.g. OnCalendar=*:8,38)"
    cal="$(calendar_from_cadence "$cadence")"
    [[ -n "$cal" ]] || die "$name: cadence produced empty OnCalendar value"
    if command -v systemd-analyze >/dev/null 2>&1; then
        local tmp_timer
        tmp_timer="$(mktemp --suffix=.timer)"
        printf '[Timer]\nOnCalendar=%s\n' "$cal" >"$tmp_timer"
        if ! systemd-analyze verify "$tmp_timer" >/dev/null 2>&1; then
            rm -f "$tmp_timer"
            die "$name: cadence not accepted by systemd-analyze: $cadence"
        fi
        rm -f "$tmp_timer"
    fi

    local here
    here="$(hostname_short)"
    if [[ -n "$host" && "$host" != "$here" && "$host" != "$(hostname)" ]]; then
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
    local json prefix script calendar delay user workdir lock state_path desc doc_registry
    json="$(registry_json "$name")"
    prefix="$(unit_prefix "$name")"
    script="$(tick_field "$json" '.probe.script')"
    calendar="$(calendar_from_cadence "$(tick_field "$json" '.cadence')")"
    delay="$(tick_field "$json" '.randomized_delay_sec' '90')"
    user="$(tick_field "$json" '.user' "${USER:-heavygee}")"
    workdir="$(tick_field "$json" '.working_directory' "/home/$user")"
    lock="$(expand_user_path "$(tick_field "$json" '.lock.path' "")" "$user")"
    if [[ -z "$lock" ]]; then
        lock="/home/$user/.local/state/hapi/tick-${name}.lock"
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
    local home_dir
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home_dir" ]] || home_dir="/home/$user"

    {
        echo "# Generated by hapi-tick from $REGISTRY"
        echo "# Do not hand-edit; re-run: hapi tick install $name"
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
        # Omit Group= — systemd uses the account primary group (may differ from username).
        echo "Nice=10"
        echo "Environment=HOME=$home_dir"
        echo "Environment=USER=$user"
        echo "Environment=PATH=$home_dir/.local/bin:/usr/local/bin:/usr/bin:/bin"
        local key val
        while IFS=$'\t' read -r key val; do
            [[ -n "$key" ]] || continue
            # Quote full KEY=value so whitespace survives systemd parsing.
            # Escape backslash and double-quote inside the value.
            val="${val//\\/\\\\}"
            val="${val//\"/\\\"}"
            echo "Environment=\"$key=$val\""
        done < <(printf '%s' "$json" | jq -r '.env // {} | to_entries[] | "\(.key)\t\(.value)"')
        echo "WorkingDirectory=$workdir"
        echo "ExecStartPre=/usr/bin/mkdir -p $(dirname "$lock") $(dirname "$state_path")"
        echo "ExecStart=/usr/bin/flock -w 60 $lock $script"
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
    systemctl stop "${prefix}.service" 2>/dev/null || true
    systemctl disable --now "${prefix}.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/${prefix}.service" "/etc/systemd/system/${prefix}.timer"
    systemctl daemon-reload
    echo "hapi-tick: uninstalled $prefix"
}

cmd_run() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "usage: hapi tick run <name>"
    validate_one "$name" >/dev/null
    local json script lock workdir user key val
    json="$(registry_json "$name")"
    script="$(tick_field "$json" '.probe.script')"
    user="$(tick_field "$json" '.user' "${USER:-}")"
    workdir="$(tick_field "$json" '.working_directory' "")"
    lock="$(expand_user_path "$(tick_field "$json" '.lock.path' "")" "$user")"
    if [[ -z "$lock" ]]; then
        lock="$(expand_user_path ~/.local/state/hapi/tick-${name}.lock "$user")"
    fi
    mkdir -p "$(dirname "$lock")"
    # Apply registry env so one-shot matches the generated unit.
    while IFS=$'\t' read -r key val; do
        [[ -n "$key" ]] || continue
        export "$key=$val"
    done < <(printf '%s' "$json" | jq -r '.env // {} | to_entries[] | "\(.key)\t\(.value)"')
    if [[ -n "$workdir" && "$workdir" != null ]]; then
        if [[ ! -d "$workdir" ]]; then
            die "working_directory not found: $workdir"
        fi
        cd "$workdir" || die "cannot cd to working_directory: $workdir"
    fi
    echo "hapi-tick: running $script (flock $lock)"
    /usr/bin/flock -w 60 "$lock" "$script"
}

doctor_one() {
    local name="$1"
    local json prefix script state_path strategy host healthy=1
    json="$(registry_json "$name")"
    prefix="$(unit_prefix "$name")"
    script="$(tick_field "$json" '.probe.script')"
    state_path="$(expand_user_path "$(tick_field "$json" '.state.path')")"
    strategy="$(tick_field "$json" '.state.strategy')"
    host="$(tick_field "$json" '.host')"

    echo "=== $name ==="
    echo "host(registry): $host  this: $(hostname_short)"
    if [[ -f "$script" ]]; then
        echo "probe: $script  exists=yes"
    else
        echo "probe: $script  exists=NO"
        healthy=0
    fi
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
        local enabled active svc_failed
        enabled="$(systemctl is-enabled "${prefix}.timer" 2>/dev/null || echo unknown)"
        active="$(systemctl is-active "${prefix}.timer" 2>/dev/null || echo unknown)"
        svc_failed="$(systemctl is-failed "${prefix}.service" 2>/dev/null || true)"
        svc_failed="${svc_failed:-unknown}"
        echo "timer: ${prefix}.timer  enabled=$enabled  active=$active"
        echo "service: ${prefix}.service  is-failed=$svc_failed"
        systemctl list-timers "${prefix}.timer" --all --no-pager 2>/dev/null | tail -n +1 | head -5 || true
        echo "recent journal:"
        journalctl -u "${prefix}.service" -n 5 --no-pager 2>/dev/null | sed 's/^/  /' || echo "  (no journal)"
        if [[ "$enabled" != "enabled" || "$active" != "active" ]]; then
            healthy=0
        fi
        if [[ "$svc_failed" == "failed" ]]; then
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
    for n in $(registry_json | jq -r '.ticks[].name'); do
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
