#!/usr/bin/env bash
# Render a .in systemd unit template with @KEY@ placeholders.
# Usage: render-hapi-systemd-unit.sh TEMPLATE.in OUTPUT [KEY=VALUE ...]
set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "usage: render-hapi-systemd-unit.sh <template.in> <output> [KEY=VALUE ...]" >&2
    exit 2
fi

template="$1"
output="$2"
shift 2

if [[ ! -f "$template" ]]; then
    echo "ERROR: template not found: $template" >&2
    exit 1
fi

content="$(<"$template")"
for pair in "$@"; do
    key="${pair%%=*}"
    val="${pair#*=}"
    content="${content//@${key}@/$val}"
done

if grep -q '@[A-Z0-9_]*@' <<<"$content"; then
    echo "ERROR: unresolved placeholders in $template:" >&2
    grep -oE '@[A-Z0-9_]+@' <<<"$content" | sort -u >&2
    exit 1
fi

mkdir -p "$(dirname "$output")"
printf '%s\n' "$content" >"$output"
