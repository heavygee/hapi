#!/usr/bin/env bash
# Full Garden stack: hub :3007 + web :5175 + ~/.hapi-garden (isolated from Claude's hapi).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export HAPI_HOME="${HAPI_HOME:-${HOME}/.hapi-garden}"
export HAPI_LISTEN_PORT="${HAPI_LISTEN_PORT:-3007}"
export HAPI_PUBLIC_URL="${HAPI_PUBLIC_URL:-https://garden.tail9944ee.ts.net}"
export VITE_HUB_PROXY="http://127.0.0.1:${HAPI_LISTEN_PORT}"
export GARDEN_WEB_PORT="${GARDEN_WEB_PORT:-5175}"

mkdir -p "${HAPI_HOME}"

if [[ ! -f "${ROOT}/hub/.env" ]]; then
  echo "Missing ${ROOT}/hub/.env — copy scripts/dev/garden-hub.env.example to hub/.env" >&2
  exit 1
fi

echo "Isolated Garden: hub :${HAPI_LISTEN_PORT}, web :${GARDEN_WEB_PORT}, HAPI_HOME=${HAPI_HOME}"

cd "${ROOT}"
exec bun x concurrently \
  "cd hub && HAPI_HOME=${HAPI_HOME} HAPI_LISTEN_PORT=${HAPI_LISTEN_PORT} HAPI_PUBLIC_URL=${HAPI_PUBLIC_URL} bun run dev" \
  "cd web && VITE_HUB_PROXY=${VITE_HUB_PROXY} bun vite --host 0.0.0.0 --port ${GARDEN_WEB_PORT} --strictPort" \
  --kill-others-on-exit
