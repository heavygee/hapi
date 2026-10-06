#!/usr/bin/env bash
# Render a .in systemd unit template with @KEY@ placeholders.
#
# Usable two ways, and both must keep working:
#   source lib/render-hapi-systemd-unit.sh   -> defines render_hapi_systemd_unit()
#   bash lib/render-hapi-systemd-unit.sh T O [K=V ...]
#
# The guard at the bottom matters: `source` with no extra arguments leaves $@ as
# the CALLER's, so top-level argument handling here used to run against the
# caller's own flags before it had parsed them — `install-hapi-systemd-units.sh
# --profile X` died on `ERROR: template not found: --profile` before doing
# anything. Keep the work in the function and the CLI behind the guard.
set -euo pipefail

render_hapi_systemd_unit() {
    if [[ $# -lt 2 ]]; then
        echo "usage: render_hapi_systemd_unit <template.in> <output> [KEY=VALUE ...]" >&2
        return 2
    fi

    local template="$1" output="$2"
    shift 2

    if [[ ! -f "$template" ]]; then
        echo "ERROR: template not found: $template" >&2
        return 1
    fi

    local content pair key val
    content="$(<"$template")"
    for pair in "$@"; do
        key="${pair%%=*}"
        val="${pair#*=}"
        content="${content//@${key}@/$val}"
    done

    if grep -q '@[A-Z0-9_]*@' <<<"$content"; then
        echo "ERROR: unresolved placeholders in $template:" >&2
        grep -oE '@[A-Z0-9_]+@' <<<"$content" | sort -u >&2
        return 1
    fi

    mkdir -p "$(dirname "$output")"
    printf '%s\n' "$content" >"$output"
}

# Only act as a CLI when executed directly, never when sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    render_hapi_systemd_unit "$@"
fi
