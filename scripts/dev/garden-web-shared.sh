#!/usr/bin/env bash
# Garden web dev (5174) using the live HAPI hub (3006) for API + sessions.
# Run alongside hapi-hub.service — no second database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HAPI_HUB="${HAPI_HUB_URL:-http://127.0.0.1:3006}"
GARDEN_WEB_PORT="${GARDEN_WEB_PORT:-5174}"

if ! curl -sf "${HAPI_HUB}/health" >/dev/null 2>&1; then
  echo "HAPI hub not reachable at ${HAPI_HUB} (start hapi-hub.service or bun run dev in ~/coding/hapi)" >&2
  exit 1
fi

if ss -ltn | grep -q ":${GARDEN_WEB_PORT} "; then
  echo "Port ${GARDEN_WEB_PORT} already in use" >&2
  exit 1
fi

echo "Garden web: http://127.0.0.1:${GARDEN_WEB_PORT}/garden"
echo "API proxy -> ${HAPI_HUB}"
echo "Tailnet (after serve): https://garden.tail9944ee.ts.net/garden"

cd "${ROOT}/web"
exec env VITE_HUB_PROXY="${HAPI_HUB}" \
  bun vite --host 0.0.0.0 --port "${GARDEN_WEB_PORT}" --strictPort
