#!/usr/bin/env bash
# Resolve hub/runner systemd unit names for homelab vs oos-linux guest.
# Override: HAPI_HUB_UNIT, HAPI_RUNNER_UNIT

hapi_systemd_unit_exists() {
    local unit="$1"
    systemctl cat "$unit" >/dev/null 2>&1
}

hapi_systemd_hub_unit() {
    if [[ -n "${HAPI_HUB_UNIT:-}" ]]; then
        echo "$HAPI_HUB_UNIT"
        return 0
    fi
    if hapi_systemd_unit_exists hapi-hub-oos.service; then
        echo hapi-hub-oos.service
    elif hapi_systemd_unit_exists hapi-hub.service; then
        echo hapi-hub.service
    else
        echo hapi-hub.service
    fi
}

hapi_systemd_runner_unit() {
    if [[ -n "${HAPI_RUNNER_UNIT:-}" ]]; then
        echo "$HAPI_RUNNER_UNIT"
        return 0
    fi
    if hapi_systemd_unit_exists hapi-runner-oos.service; then
        echo hapi-runner-oos.service
    elif hapi_systemd_unit_exists hapi-runner.service; then
        echo hapi-runner.service
    else
        echo hapi-runner.service
    fi
}

hapi_systemd_hub_db_path() {
    if [[ -n "${HAPI_HUB_DB:-}" ]]; then
        echo "$HAPI_HUB_DB"
        return 0
    fi
    if [[ -f /var/lib/hapi/hapi.db ]]; then
        echo /var/lib/hapi/hapi.db
    elif [[ -f "$HOME/.hapi/hapi.db" ]]; then
        echo "$HOME/.hapi/hapi.db"
    else
        echo "$HOME/.hapi/hapi.db"
    fi
}
