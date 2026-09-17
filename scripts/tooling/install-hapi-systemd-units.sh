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
# Estate-local drop-ins (cursor auth, work-cache, upload-heal) stay in
# /etc/systemd/system/*.service.d/ and are never overwritten by this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/render-hapi-systemd-unit.sh
source "$REPO_ROOT/scripts/tooling/lib/render-hapi-systemd-unit.sh"
# shellcheck source=lib/hapi-systemd-units.sh
source "$REPO_ROOT/scripts/tooling/lib/hapi-systemd-units.sh"

PROFILE=""
UNITS_ONLY=0
DO_ENABLE=0
DO_RESTART=0
HAPI_USER="${HAPI_USER:-}"
HAPI_GROUP="${HAPI_GROUP:-}"
HAPI_HOME="${HAPI_HOME:-}"
HAPI_DRIVER_DIR="${HAPI_DRIVER_DIR:-}"
HAPI_BIN="${HAPI_BIN:-/opt/hapi/hapi}"
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
        render-hapi-systemd-unit.sh "$hub_template" "$hub_out" \
            "${common[@]}" \
            "HAPI_DRIVER_DIR=$HAPI_DRIVER_DIR" \
            "BUN_BIN=$BUN_BIN"
        render-hapi-systemd-unit.sh "$runner_template" "$runner_out" \
            "${common[@]}" \
            "HAPI_DRIVER_DIR=$HAPI_DRIVER_DIR" \
            "BUN_BIN=$BUN_BIN" \
            "HAPI_AGENT_ENV=$HAPI_AGENT_ENV" \
            "EXEC_START_PRE_LINE=$EXEC_START_PRE_LINE"
    elif [[ "$PROFILE" == fleet-binary ]]; then
        render-hapi-systemd-unit.sh "$hub_template" "$hub_out" \
            "${common[@]}" \
            "HAPI_BIN=$HAPI_BIN"
        render-hapi-systemd-unit.sh "$runner_template" "$runner_out" \
            "${common[@]}" \
            "HAPI_BIN=$HAPI_BIN"
    else
        render-hapi-systemd-unit.sh "$hub_template" "$hub_out" \
            "HOST_LABEL=$HOST_LABEL" \
            "HAPI_HOME=$HAPI_HOME" \
            "HAPI_PATH=$HAPI_PATH" \
            "HAPI_BIN=$HAPI_BIN"
        render-hapi-systemd-unit.sh "$runner_template" "$runner_out" \
            "HOST_LABEL=$HOST_LABEL" \
            "HAPI_HOME=$HAPI_HOME" \
            "HAPI_PATH=$HAPI_PATH" \
            "HAPI_BIN=$HAPI_BIN" \
            "WORKSPACE_ROOT_ARGS=$WORKSPACE_ROOT_ARGS"
    fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

case "$PROFILE" in
    primary-soup|fleet-binary)
        HUB_DST="/etc/systemd/system/$HUB_UNIT"
        RUNNER_DST="/etc/systemd/system/$RUNNER_UNIT"
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
        if [[ "$UNITS_ONLY" -eq 0 ]]; then
            bash "$REPO_ROOT/scripts/tooling/install-hapi-primary-hub-tier1.sh"
        fi
        if [[ "$DO_RESTART" -eq 1 ]]; then
            if [[ -x /home/heavygee/.local/bin/hapi-restart-hub ]]; then
                sudo -u heavygee -H /home/heavygee/.local/bin/hapi-restart-hub
            else
                systemctl restart "$HUB_UNIT" "$RUNNER_UNIT"
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
        if [[ "$DO_ENABLE" -eq 1 ]]; then
            loginctl enable-linger "$(id -un)" 2>/dev/null || true
            systemctl --user enable hapi-hub.service hapi-runner.service
            systemctl --user start hapi-hub.service hapi-runner.service
        fi
        ;;
esac

echo
echo "Profile: $PROFILE"
echo "Verify: bash $REPO_ROOT/scripts/tooling/verify-hapi-systemd-units.sh"
