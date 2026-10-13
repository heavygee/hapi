#!/usr/bin/env bash
# Operator entry: dispatch a sealed tip across fleet target types (#258).
# Usually invoked from hapi-fleet-seal after local + GH pointers move.
# FORK-ONLY. Spoken gate still required before agents invent a seal.
#
# Usage:
#   hapi-fleet-seal-dispatch <hapi-soup-v…> [--dry-run]
#   HAPI_SKIP_FLEET_DISPATCH=1 hapi-fleet-seal …   # seal without dispatch
#
set -euo pipefail

LIB_DIR="$(dirname "$(readlink -f "$0")")/lib"
# shellcheck source=lib/hapi-fleet-seal-dispatch.sh
source "$LIB_DIR/hapi-fleet-seal-dispatch.sh"

hapi_fleet_seal_dispatch "$@"
