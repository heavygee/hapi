#!/usr/bin/env bash
# REMOVED (ADR D8 / tiann/hapi#1163). Title-emoji fleet retitle is gone.
# Chip owns health: ./scripts/tooling/hapi-meta-daily.sh [--pr N]
# Canon: docs/tooling/feature-work-lifecycle.md § Session titles and PR chips
set -euo pipefail
pr=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --pr) pr=" --pr $2"; shift 2 ;;
        *) shift ;;
    esac
done
cat >&2 <<EOF
hapi-pr-session-emoji: removed (ADR D8). Do not stop — run the successor:

  ./scripts/tooling/hapi-meta-daily.sh${pr}

That refreshes session PR chip status (externalRefs). Never PATCH titles with ✅🔁⚠️📝🔧.
EOF
exit 2
