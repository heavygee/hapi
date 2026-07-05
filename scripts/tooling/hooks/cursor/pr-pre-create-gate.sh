#!/usr/bin/env bash
# Backward-compat shim — use pr-before-shell-gates.sh from hooks.json.
exec "$(dirname "$0")/pr-before-shell-gates.sh" "$@"
