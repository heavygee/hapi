#!/usr/bin/env bash
# build_web_preflight — refuse vite when memory pressure makes SIGTERM likely.
#
# MemAvailable floor is the primary gate. High swap alone (sticky pages from an
# earlier spike) does not block when plenty of RAM is free.
# Exit 0 = OK to build; 1 = refuse with recovery hints.
build_web_preflight() {
    local max_swap_pct="${HAPI_BUILD_MAX_SWAP_USED_PCT:-85}"
    local min_avail_kib="${HAPI_BUILD_MIN_AVAIL_MEM_KIB:-2097152}" # 2 GiB
    # Block on high swap only when RAM headroom is also tight (active pressure).
    local swap_pressure_avail_kib="${HAPI_BUILD_SWAP_PRESSURE_AVAIL_KIB:-4194304}" # 4 GiB

    # Runtime env bypass (2026-06-28 mermaid session): agents export then run build in a second command.
    if [[ "${HAPI_OPERATOR_BUILD_PREFLIGHT_OVERRIDE:-}" != "1" ]]; then
        if [[ "${HAPI_AGENT_CONTEXT:-}" == "1" ]] || [[ ! -t 1 ]]; then
            if [[ -n "${HAPI_BUILD_MAX_SWAP_USED_PCT:-}" && "${HAPI_BUILD_MAX_SWAP_USED_PCT}" -gt 85 ]]; then
                echo "ERROR: HAPI_BUILD_MAX_SWAP_USED_PCT=${HAPI_BUILD_MAX_SWAP_USED_PCT} refused from agent shell." >&2
                echo "       Report blocked. Operator: swapoff/swapon or drain sessions, then rebuild." >&2
                return 1
            fi
            if [[ -n "${HAPI_BUILD_MIN_AVAIL_MEM_KIB:-}" && "${HAPI_BUILD_MIN_AVAIL_MEM_KIB}" -lt 2097152 ]]; then
                echo "ERROR: HAPI_BUILD_MIN_AVAIL_MEM_KIB=${HAPI_BUILD_MIN_AVAIL_MEM_KIB} refused from agent shell." >&2
                return 1
            fi
        fi
    fi

    if [[ "${HAPI_BUILD_PREFLIGHT_SKIP_DROP_CACHES:-}" != "1" ]]; then
        if [[ -w /proc/sys/vm/drop_caches ]] || sudo -n true 2>/dev/null; then
            sync
            if [[ -w /proc/sys/vm/drop_caches ]]; then
                echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true
            else
                sudo -n sh -c 'sync; echo 1 > /proc/sys/vm/drop_caches' 2>/dev/null || true
            fi
        fi
    fi

    local avail swap_used_pct swap_total
    if [[ -n "${HAPI_BUILD_TEST_MEM_AVAILABLE_KIB:-}" ]]; then
        avail="${HAPI_BUILD_TEST_MEM_AVAILABLE_KIB}"
    else
        avail="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
    fi

    if [[ -n "${HAPI_BUILD_TEST_SWAP_USED_PCT:-}" ]]; then
        swap_used_pct="${HAPI_BUILD_TEST_SWAP_USED_PCT}"
        swap_total="${HAPI_BUILD_TEST_SWAP_TOTAL_KIB:-1}"
    else
        read -r swap_used_pct swap_total <<<"$(free | awk '/Swap:/ { if ($2>0) printf "%d %d", ($3*100)/$2, $2; else print "0 0" }')"
    fi

    if (( avail < min_avail_kib )); then
        echo "ERROR: MemAvailable $(( avail / 1024 ))MiB below $(( min_avail_kib / 1024 ))MiB floor — refuse vite build." >&2
        echo "       Try: sync; sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'" >&2
        echo "       If swap is full: sudo swapoff -a && sudo swapon -a (slow; ~3min on this host)" >&2
        return 1
    fi

    if (( swap_total > 0 && swap_used_pct > max_swap_pct && avail < swap_pressure_avail_kib )); then
        echo "ERROR: swap ${swap_used_pct}% used and MemAvailable $(( avail / 1024 ))MiB below $(( swap_pressure_avail_kib / 1024 ))MiB — active memory pressure; vite builds SIGTERM here." >&2
        echo "       Recovery (operator TTY): sync; sudo swapoff -a && sudo swapon -a" >&2
        echo "       Or wait for remote agents to drain: hapi-remote-agent-budget.sh" >&2
        echo "       Then: hapi-driver-build-web" >&2
        return 1
    fi

    if (( swap_total > 0 && swap_used_pct > max_swap_pct )); then
        echo "build_web_preflight: WARN swap ${swap_used_pct}% used but MemAvailable $(( avail / 1024 ))MiB >= $(( swap_pressure_avail_kib / 1024 ))MiB — proceeding (sticky swap)" >&2
    fi

    echo "build_web_preflight: OK avail=$(( avail / 1024 ))MiB swap_used=${swap_used_pct}%"
    return 0
}
