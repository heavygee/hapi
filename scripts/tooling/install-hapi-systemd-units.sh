#!/usr/bin/env bash
# install-hapi-systemd-units.sh
#
# Install canonical HAPI hub + runner systemd units from repo templates.
# Idempotent. Safe to re-run on cattle rebuild / fleet bring-up / oos remat.
#
# Profiles:
#   primary-soup   — oos-linux soup kitchen (system hapi-*-oos units, bun driver)
#   fleet-binary   — fleet VM shards (system hapi-hub/hapi-runner, single-exe /opt/hapi/hapi)
#   user-pet       — standalone pet installs (user-level ~/.config/systemd/user)
#
# System profiles also install Tier-1 drop-ins (KillMode resilience, OOM scores,
# watchdog) via install-hapi-primary-hub-tier1.sh unless --units-only.
#
# Usage:
#   sudo bash scripts/tooling/install-hapi-systemd-units.sh --profile primary-soup
#   sudo bash scripts/tooling/install-hapi-systemd-units.sh --profile fleet-binary \
#       --hapi-user hapi --workspace-root /work
#   bash scripts/tooling/install-hapi-systemd-units.sh --profile user-pet
#
# Also installs the Claude OAuth EnvironmentFile drop-in (42-claude-oauth-token.conf)
# so runner-spawned Claude sessions inherit CLAUDE_CODE_OAUTH_TOKEN. UI spawn does
# not inject options.token — see lib/hapi-claude-oauth-dropin.sh.
# System profiles require python3 on PATH (O_NOFOLLOW migrate/chmod of /etc/hapi).
#
# Estate-local drop-ins (cursor auth, work-cache, upload-heal) stay in
# /etc/systemd/system/*.service.d/ and are never overwritten by this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/render-hapi-systemd-unit.sh
source "$REPO_ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"
# shellcheck source=lib/hapi-claude-oauth-dropin.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-claude-oauth-dropin.sh"

PROFILE=""
UNITS_ONLY=0
DO_ENABLE=0
DO_RESTART=0
HAPI_USER="${HAPI_USER:-}"
HAPI_GROUP="${HAPI_GROUP:-}"
HAPI_HOME="${HAPI_HOME:-}"
HAPI_DRIVER_DIR="${HAPI_DRIVER_DIR:-}"
# Do NOT default to /opt/hapi/hapi here — that is fleet-binary's default.
# A global default made user-pet units ExecStart a missing path (203/EXEC) on
# the 2026-09-30 stranger-install rehearsal. Profile cases below set defaults;
# --hapi-bin still wins when the caller exports/passes it.
HAPI_BIN="${HAPI_BIN:-}"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
HAPI_PORT="${HAPI_PORT:-3006}"
HOST_LABEL="${HOST_LABEL:-$(hostname -s)}"
HAPI_AGENT_ENV="${HAPI_AGENT_ENV:-$HOME/.config/hapi-oos-agent.env}"
PIN_CURSOR_AUTH="${PIN_CURSOR_AUTH:-$HOME/.hapi/pin-cursor-auth.sh}"
WORKSPACE_ROOTS=()

usage() {
    sed -n '2,28p' "$0" | sed 's/^# \?//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile) PROFILE="$2"; shift 2 ;;
        --units-only) UNITS_ONLY=1; shift ;;
        --enable) DO_ENABLE=1; shift ;;
        --restart) DO_RESTART=1; shift ;;
        --hapi-user) HAPI_USER="$2"; shift 2 ;;
        --hapi-home) HAPI_HOME="$2"; shift 2 ;;
        --driver-dir) HAPI_DRIVER_DIR="$2"; shift 2 ;;
        --hapi-bin) HAPI_BIN="$2"; shift 2 ;;
        --port) HAPI_PORT="$2"; shift 2 ;;
        --workspace-root) WORKSPACE_ROOTS+=("$2"); shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ -z "$PROFILE" ]]; then
    echo "ERROR: --profile required (primary-soup | fleet-binary | user-pet)" >&2
    exit 2
fi

hapi_systemd_format_workspace_args() {
    local args=()
    local root
    for root in "$@"; do
        args+=("--workspace-root" "$root")
    done
    printf '%s' "${args[*]}"
}

hapi_systemd_default_path() {
    local user_home="$1"
    printf '%s/.local/bin:%s/.bun/bin:%s/.npm-global/bin:/usr/local/bin:/usr/bin:/bin' \
        "$user_home" "$user_home" "$user_home"
}

case "$PROFILE" in
    primary-soup)
        OOS_OPERATOR_USER="${OOS_OPERATOR_USER:-heavygee}"
        OOS_OPERATOR_HOME="${OOS_OPERATOR_HOME:-/home/$OOS_OPERATOR_USER}"
        HAPI_USER="${HAPI_USER:-$OOS_OPERATOR_USER}"
        HAPI_GROUP="${HAPI_GROUP:-$OOS_OPERATOR_USER}"
        HAPI_HOME="${HAPI_HOME:-/var/lib/hapi}"
        HAPI_DRIVER_DIR="${HAPI_DRIVER_DIR:-$OOS_OPERATOR_HOME/coding/hapi/active}"
        BUN_BIN="${BUN_BIN:-$OOS_OPERATOR_HOME/.bun/bin/bun}"
        HAPI_AGENT_ENV="${HAPI_AGENT_ENV:-$OOS_OPERATOR_HOME/.config/hapi-oos-agent.env}"
        PIN_CURSOR_AUTH="${PIN_CURSOR_AUTH:-$OOS_OPERATOR_HOME/.hapi/pin-cursor-auth.sh}"
        if [[ ${#WORKSPACE_ROOTS[@]} -eq 0 ]]; then
            WORKSPACE_ROOTS=(
                "$OOS_OPERATOR_HOME/coding"
                "$HAPI_DRIVER_DIR"
                "$OOS_OPERATOR_HOME/coding/janus-oos"
                /work
            )
        fi
        HUB_UNIT=hapi-hub-oos.service
        RUNNER_UNIT=hapi-runner-oos.service
        TEMPLATE_DIR="$REPO_ROOT/scripts/tooling/systemd/units/primary-soup"
        NEED_ROOT=1
        ;;
    fleet-binary)
        HAPI_USER="${HAPI_USER:-hapi}"
        HAPI_GROUP="${HAPI_GROUP:-hapi}"
        HAPI_HOME="${HAPI_HOME:-/var/lib/hapi}"
        HAPI_BIN="${HAPI_BIN:-/opt/hapi/hapi}"
        if [[ ${#WORKSPACE_ROOTS[@]} -eq 0 ]]; then
            WORKSPACE_ROOTS=(/work)
        fi
        HUB_UNIT=hapi-hub.service
        RUNNER_UNIT=hapi-runner.service
        TEMPLATE_DIR="$REPO_ROOT/scripts/tooling/systemd/units/fleet-binary"
        NEED_ROOT=1
        ;;
    user-pet)
        HAPI_USER="${HAPI_USER:-$(id -un)}"
        HAPI_HOME="${HAPI_HOME:-$HOME/.hapi}"
        HAPI_BIN="${HAPI_BIN:-${INSTALL_DIR:-$HOME/.local/bin}/hapi}"
        if [[ ${#WORKSPACE_ROOTS[@]} -eq 0 ]]; then
            WORKSPACE_ROOTS=("${HAPI_WORKSPACE:-$HOME/.hapi-workspace}")
        fi
        HUB_UNIT=hapi-hub.service
        RUNNER_UNIT=hapi-runner.service
        TEMPLATE_DIR="$REPO_ROOT/scripts/tooling/systemd/units/user-pet"
        NEED_ROOT=0
        ;;
    *)
        echo "ERROR: unknown profile: $PROFILE" >&2
        exit 2
        ;;
esac

if [[ "$NEED_ROOT" -eq 1 ]] && [[ "$(id -u)" -ne 0 ]]; then
    echo "ERROR: profile $PROFILE requires root (sudo bash $0 ...)" >&2
    exit 1
fi

# Fail before touching units: system OAuth migrate/chmod needs python3 O_NOFOLLOW.
if [[ "$NEED_ROOT" -eq 1 ]] && ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required for profile $PROFILE (Claude OAuth drop-in under /etc/hapi)" >&2
    echo "       Install python3, then re-run: sudo bash $0 --profile $PROFILE ..." >&2
    exit 1
fi

user_home="$(getent passwd "$HAPI_USER" | cut -d: -f6 || echo "$HOME")"
HAPI_PATH="${HAPI_PATH:-$(hapi_systemd_default_path "$user_home")}"
WORKSPACE_ROOT_ARGS="$(hapi_systemd_format_workspace_args "${WORKSPACE_ROOTS[@]}")"

EXEC_START_PRE_LINE=""
if [[ "$PROFILE" == primary-soup ]] && [[ -x "$PIN_CURSOR_AUTH" ]]; then
    EXEC_START_PRE_LINE="ExecStartPre=$PIN_CURSOR_AUTH"
fi

render_pair() {
    local hub_template="$1"
    local runner_template="$2"
    local hub_out="$3"
    local runner_out="$4"

    local -a common=(
        "HOST_LABEL=$HOST_LABEL"
        "HAPI_USER=$HAPI_USER"
        "HAPI_GROUP=${HAPI_GROUP:-$HAPI_USER}"
        "HAPI_HOME=$HAPI_HOME"
        "HAPI_PORT=$HAPI_PORT"
        "HAPI_PATH=$HAPI_PATH"
        "HUB_UNIT=$HUB_UNIT"
        "WORKSPACE_ROOT_ARGS=$WORKSPACE_ROOT_ARGS"
    )

    if [[ "$PROFILE" == primary-soup ]]; then
        render_hapi_systemd_unit "$hub_template" "$hub_out" \
            "${common[@]}" \
            "HAPI_DRIVER_DIR=$HAPI_DRIVER_DIR" \
            "BUN_BIN=$BUN_BIN"
        render_hapi_systemd_unit "$runner_template" "$runner_out" \
            "${common[@]}" \
            "HAPI_DRIVER_DIR=$HAPI_DRIVER_DIR" \
            "BUN_BIN=$BUN_BIN" \
            "HAPI_AGENT_ENV=$HAPI_AGENT_ENV" \
            "EXEC_START_PRE_LINE=$EXEC_START_PRE_LINE"
    elif [[ "$PROFILE" == fleet-binary ]]; then
        render_hapi_systemd_unit "$hub_template" "$hub_out" \
            "${common[@]}" \
            "HAPI_BIN=$HAPI_BIN"
        render_hapi_systemd_unit "$runner_template" "$runner_out" \
            "${common[@]}" \
            "HAPI_BIN=$HAPI_BIN"
    else
        render_hapi_systemd_unit "$hub_template" "$hub_out" \
            "HOST_LABEL=$HOST_LABEL" \
            "HAPI_HOME=$HAPI_HOME" \
            "HAPI_PATH=$HAPI_PATH" \
            "HAPI_BIN=$HAPI_BIN"
        render_hapi_systemd_unit "$runner_template" "$runner_out" \
            "HOST_LABEL=$HOST_LABEL" \
            "HAPI_HOME=$HAPI_HOME" \
            "HAPI_PATH=$HAPI_PATH" \
            "HAPI_BIN=$HAPI_BIN" \
            "WORKSPACE_ROOT_ARGS=$WORKSPACE_ROOT_ARGS"
    fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# True when MainPID still has CLAUDE_CODE_OAUTH_TOKEN but $1 (canonical token
# file) has no effective assignment. Used before enabling/restoring watchdog.
hapi_system_runner_ambient_oauth_unpersisted() {
    local token_file="${1:?token_file}"
    local unit="${2:?unit}"
    if hapi_claude_oauth_has_effective_token "$token_file" 2>/dev/null; then
        return 1
    fi
    local runner_main_pid ambient_tok="" env_line
    runner_main_pid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || echo 0)"
    if [[ "$runner_main_pid" == "0" || ! -r "/proc/$runner_main_pid/environ" ]]; then
        return 1
    fi
    while IFS= read -r -d '' env_line || [[ -n "$env_line" ]]; do
        case "$env_line" in
            CLAUDE_CODE_OAUTH_TOKEN=*)
                ambient_tok="${env_line#CLAUDE_CODE_OAUTH_TOKEN=}"
                ;;
        esac
    done <"/proc/$runner_main_pid/environ"
    [[ -n "$ambient_tok" ]]
}

case "$PROFILE" in
    primary-soup|fleet-binary)
        HUB_DST="/etc/systemd/system/$HUB_UNIT"
        RUNNER_DST="/etc/systemd/system/$RUNNER_UNIT"
        # Quiesce a pre-existing watchdog before rewriting units / migrate.
        # stop (not disable): the timer stays enabled; we only prevent a fire
        # during the window where EnvironmentFile may be unwired. A failed
        # migrate exits with the timer left stopped (fail-closed).
        WD_TIMER_WAS_ACTIVE=0
        if systemctl is-active --quiet hapi-runner-watchdog.timer 2>/dev/null; then
            WD_TIMER_WAS_ACTIVE=1
        fi
        systemctl stop hapi-runner-watchdog.timer 2>/dev/null || true
        systemctl stop hapi-runner-watchdog.service 2>/dev/null || true
        render_pair \
            "$TEMPLATE_DIR/$HUB_UNIT.in" \
            "$TEMPLATE_DIR/$RUNNER_UNIT.in" \
            "$TMP_DIR/$HUB_UNIT" \
            "$TMP_DIR/$RUNNER_UNIT"
        install -m 0644 "$TMP_DIR/$HUB_UNIT" "$HUB_DST"
        install -m 0644 "$TMP_DIR/$RUNNER_UNIT" "$RUNNER_DST"
        systemctl daemon-reload
        echo "Installed: $HUB_DST"
        echo "Installed: $RUNNER_DST"
        if [[ "$DO_ENABLE" -eq 1 ]]; then
            systemctl enable "$HUB_UNIT" "$RUNNER_UNIT"
        fi
        # System-scope token is always root-controlled /etc/hapi/claude-setup-token.env
        # (NOT under service-writable HAPI_HOME or operator ~/.hapi). Compromised
        # runner + passwordless Restart must not retarget EnvironmentFile at other
        # root-readable secrets. primary-soup 2026-08-25 hand-install under
        # $OPERATOR_HOME/.hapi/ is a one-time migrate (WARN from the drop-in).
        # Run migrate/drop-in BEFORE Tier-1: the watchdog timer can restart the
        # runner; a failed migrate must not leave watchdog able to discard ambient
        # auth before EnvironmentFile exists.
        CLAUDE_TOKEN_FILE="$(hapi_claude_oauth_system_token_file)"
        HAPI_CLAUDE_OAUTH_MIGRATE_PENDING=0
        # primary-soup: pass configured operator home (not sudoer's HOME=/root).
        DROPIN_ARGS=(
            --scope system
            --runner-unit "$RUNNER_UNIT"
            --token-file "$CLAUDE_TOKEN_FILE"
            --migrate-profile "$PROFILE"
            --migrate-hapi-home "$HAPI_HOME"
        )
        if [[ "$PROFILE" == primary-soup ]]; then
            DROPIN_ARGS+=(--migrate-operator-home "${OOS_OPERATOR_HOME:-/home/heavygee}")
        fi
        set +e
        hapi_install_claude_oauth_dropin "${DROPIN_ARGS[@]}"
        dropin_rc=$?
        set -e
        # Fail closed on config-only installs too: pending migrate must not leave
        # a drop-in pointed at an empty/missing /etc/hapi token.
        if [[ "$dropin_rc" -ne 0 || "${HAPI_CLAUDE_OAUTH_MIGRATE_PENDING:-0}" -eq 1 ]]; then
            echo "ERROR: Claude OAuth drop-in install failed or migrate still pending ($CLAUDE_TOKEN_FILE)" >&2
            echo "       Resolve legacy token ambiguity / symlink, then re-run." >&2
            echo "       hapi-runner-watchdog.timer was stopped for this upgrade and left stopped." >&2
            exit 1
        fi
        if hapi_system_runner_ambient_oauth_unpersisted "$CLAUDE_TOKEN_FILE" "$RUNNER_UNIT"; then
            echo "ERROR: runner has ambient CLAUDE_CODE_OAUTH_TOKEN but $CLAUDE_TOKEN_FILE is missing/empty" >&2
            echo "       Persist the token before enabling the watchdog or you will discard the only credential." >&2
            echo "       hapi-runner-watchdog.timer was stopped for this upgrade and left stopped." >&2
            exit 1
        fi
        if [[ "$UNITS_ONLY" -eq 0 ]]; then
            # Pass the binary this profile just installed, so Tier-1's
            # ExecStartPre stop is valid on THIS host. Without it Tier-1 would
            # fall back to auto-detection, and historically shipped a
            # soup-only stop verbatim to every profile (silently a no-op).
            # This script already knows the exact layout it just rendered, so
            # tell Tier-1 rather than making it guess. Its auto-detect only
            # handles the single-exe shape and fails closed otherwise — which is
            # correct, but would abort us mid-install (base units written,
            # daemon-reload done, drop-ins and watchdog not).
            # Everything Tier-1 would otherwise have to infer, we already know
            # exactly — we just rendered the units from it. Passing it removes
            # the guessing entirely, including the User= lookup that cannot
            # distinguish "runs as root" from "unit does not exist".
            TIER1_ARGS=(
                --watchdog-user "$HAPI_USER"
                --hapi-home "$HAPI_HOME"
                --hapi-port "$HAPI_PORT"
            )
            case "$PROFILE" in
                fleet-binary)
                    TIER1_ARGS+=(--runner-bin "$HAPI_BIN")
                    ;;
                primary-soup)
                    TIER1_ARGS+=(--runner-stop-cmd \
                        "-/bin/bash -lc '$BUN_BIN run --cwd $HAPI_DRIVER_DIR/cli $HAPI_DRIVER_DIR/cli/src/index.ts runner stop'")
                    ;;
            esac
            bash "$REPO_ROOT/scripts/tooling/install-hapi-primary-hub-tier1.sh" "${TIER1_ARGS[@]}"
        fi
        if [[ "$DO_RESTART" -eq 1 ]]; then
            # Fail closed: missing/ineffective canonical while a legacy token still
            # exists, OR an empty canonical file that systemd would load as blank.
            block_restart=0
            op_home=""
            [[ "$PROFILE" == primary-soup ]] && op_home="${OOS_OPERATOR_HOME:-/home/heavygee}"
            if hapi_claude_oauth_has_effective_token "$CLAUDE_TOKEN_FILE" 2>/dev/null; then
                :
            else
                if [[ -e "$CLAUDE_TOKEN_FILE" || -L "$CLAUDE_TOKEN_FILE" ]]; then
                    block_restart=1
                fi
                while IFS= read -r legacy_probe; do
                    if [[ -e "$legacy_probe" || -L "$legacy_probe" ]]; then
                        block_restart=1
                        break
                    fi
                done < <(hapi_claude_oauth_legacy_system_token_candidates "$PROFILE" "$HAPI_HOME" "$op_home")
                if hapi_system_runner_ambient_oauth_unpersisted "$CLAUDE_TOKEN_FILE" "$RUNNER_UNIT"; then
                    block_restart=1
                    echo "ERROR: runner has ambient CLAUDE_CODE_OAUTH_TOKEN but $CLAUDE_TOKEN_FILE is missing/empty" >&2
                    echo "       Persist the token to $CLAUDE_TOKEN_FILE before --restart or you will discard the only credential." >&2
                fi
            fi
            if [[ "$block_restart" -eq 1 ]]; then
                echo "ERROR: refusing --restart until Claude OAuth token is effective at $CLAUDE_TOKEN_FILE" >&2
                echo "       Legacy path still present, empty canonical, ambient-only token, or migrate failed." >&2
                echo "       Migrate with: hapi_claude_oauth_secure_copy_regular_file <legacy> $CLAUDE_TOKEN_FILE" >&2
                exit 1
            fi
            if [[ -x /home/heavygee/.local/bin/hapi-restart-hub ]]; then
                sudo -u heavygee -H /home/heavygee/.local/bin/hapi-restart-hub
            else
                systemctl restart "$HUB_UNIT" "$RUNNER_UNIT"
            fi
        fi
        # --units-only skips Tier-1 (which restarts the timer). After a successful
        # migrate, put back a timer we quiesced.
        if [[ "$UNITS_ONLY" -eq 1 && "${WD_TIMER_WAS_ACTIVE:-0}" -eq 1 ]]; then
            if hapi_system_runner_ambient_oauth_unpersisted "$CLAUDE_TOKEN_FILE" "$RUNNER_UNIT"; then
                echo "ERROR: runner has ambient CLAUDE_CODE_OAUTH_TOKEN but $CLAUDE_TOKEN_FILE is missing/empty" >&2
                echo "       Persist the token before restoring the watchdog timer." >&2
                echo "       hapi-runner-watchdog.timer was left stopped." >&2
                exit 1
            fi
            if ! systemctl start hapi-runner-watchdog.timer; then
                echo "ERROR: failed to restore hapi-runner-watchdog.timer after --units-only" >&2
                echo "       Timer was active before this upgrade and was left stopped." >&2
                exit 1
            fi
            if ! systemctl is-active --quiet hapi-runner-watchdog.timer; then
                echo "ERROR: hapi-runner-watchdog.timer did not become active after restore" >&2
                exit 1
            fi
        fi
        ;;
    user-pet)
        USER_UNIT_DIR="$HOME/.config/systemd/user"
        mkdir -p "$USER_UNIT_DIR"
        render_pair \
            "$TEMPLATE_DIR/hapi-hub.service.in" \
            "$TEMPLATE_DIR/hapi-runner.service.in" \
            "$TMP_DIR/hapi-hub.service" \
            "$TMP_DIR/hapi-runner.service"
        install -m 0644 "$TMP_DIR/hapi-hub.service" "$USER_UNIT_DIR/hapi-hub.service"
        install -m 0644 "$TMP_DIR/hapi-runner.service" "$USER_UNIT_DIR/hapi-runner.service"
        systemctl --user daemon-reload
        echo "Installed: $USER_UNIT_DIR/hapi-hub.service"
        echo "Installed: $USER_UNIT_DIR/hapi-runner.service"
        CLAUDE_TOKEN_FILE="$(hapi_claude_oauth_default_token_file "$HAPI_HOME")"
        hapi_install_claude_oauth_dropin \
            --scope user \
            --runner-unit hapi-runner.service \
            --token-file "$CLAUDE_TOKEN_FILE" \
            --unit-dir "$USER_UNIT_DIR"
        # Ambient-only guard (mirrors system-profile --restart): if the runner
        # still carries CLAUDE_CODE_OAUTH_TOKEN in MainPID environ but no durable
        # file exists to reload, refuse restart so we do not force /login.
        hapi_user_pet_refuse_ambient_only_restart() {
            local token_file="$1"
            if hapi_claude_oauth_has_effective_token "$token_file" 2>/dev/null; then
                return 0
            fi
            local legacy_token
            legacy_token="$(dirname "$token_file")/.hapi/claude-setup-token.env"
            if hapi_claude_oauth_has_effective_token "$legacy_token" 2>/dev/null; then
                return 0
            fi
            local runner_main_pid ambient_tok="" env_line
            runner_main_pid="$(systemctl --user show -p MainPID --value hapi-runner.service 2>/dev/null || echo 0)"
            if [[ "$runner_main_pid" != "0" && -r "/proc/$runner_main_pid/environ" ]]; then
                while IFS= read -r -d '' env_line || [[ -n "$env_line" ]]; do
                    case "$env_line" in
                        CLAUDE_CODE_OAUTH_TOKEN=*)
                            ambient_tok="${env_line#CLAUDE_CODE_OAUTH_TOKEN=}"
                            ;;
                    esac
                done <"/proc/$runner_main_pid/environ"
                if [[ -n "$ambient_tok" ]]; then
                    echo "ERROR: user-pet runner MainPID=$runner_main_pid has ambient CLAUDE_CODE_OAUTH_TOKEN but $token_file is missing/empty" >&2
                    echo "       Persist the token to $token_file before restart or you will discard the only credential." >&2
                    return 1
                fi
            fi
            return 0
        }
        if [[ "$DO_ENABLE" -eq 1 ]]; then
            loginctl enable-linger "$(id -un)" 2>/dev/null || true
            systemctl --user enable hapi-hub.service hapi-runner.service
            # Same race as the embedded pet path: pgrep kill + Restart=always can
            # respawn the old hub/runner binary before INSTALL_DIR is swapped;
            # systemctl start is then a no-op for already-active units.
            hapi_user_pet_refuse_ambient_only_restart "$CLAUDE_TOKEN_FILE" || exit 1
            systemctl --user restart hapi-hub.service
            systemctl --user restart hapi-runner.service
        elif [[ "$DO_RESTART" -eq 1 ]] && systemctl --user is-active --quiet hapi-runner.service 2>/dev/null; then
            # Config-only reruns must not yank MainPID unless the operator asked.
            hapi_user_pet_refuse_ambient_only_restart "$CLAUDE_TOKEN_FILE" || exit 1
            systemctl --user restart hapi-hub.service
            systemctl --user restart hapi-runner.service
        fi
        unset -f hapi_user_pet_refuse_ambient_only_restart
        ;;
esac

echo
echo "Profile: $PROFILE"
echo "Verify: bash $REPO_ROOT/scripts/tooling/verify-hapi-systemd-units.sh"
if [[ "$PROFILE" == user-pet ]]; then
    echo "        bash $REPO_ROOT/scripts/tooling/verify-hapi-install.sh --skip-restart"
else
    echo "        sudo bash $REPO_ROOT/scripts/tooling/verify-hapi-install.sh --skip-restart"
    echo "        (system-scope OAuth file is root:root 0600; verify as root)"
fi
