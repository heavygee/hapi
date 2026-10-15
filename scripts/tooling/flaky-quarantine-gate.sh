#!/usr/bin/env bash
# flaky-quarantine-gate.sh <repo-root>
#
# Shared `bun run test` replacement for BOTH the local remat gate
# (hapi-driver-rebuild.sh) and CI (.github/workflows/test.yml) — the SAME
# script, so the two gates cannot drift onto different interpretations of
# config/flaky-quarantine.yaml. See docs/tooling/flaky-quarantine.md.
#
# Only `cli` is quarantine-aware today — that is where the two seed entries
# (heavygee/hapi#273's iOS siblings are a separate `ios:` id space checked by
# ios/scripts/test-transcript.sh; #274 is the cli-side entry here) live.
# hub/web/shared/relay run exactly as before, unchanged, fully blocking.
# Extending quarantine awareness to another package is the same
# vitest-json-reporter + adapter + check sequence repeated for that package.
set -euo pipefail

REPO_ROOT="${1:?usage: flaky-quarantine-gate.sh <repo-root>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_plain() {
    echo "Running $1 tests..."
    (cd "$REPO_ROOT/$1" && bun run test)
}

run_plain hub
run_plain web
run_plain shared
run_plain relay

echo "Running cli tests (quarantine-aware)..."
CLI_JSON="$(mktemp -t flaky-quarantine-cli-XXXXXX.json)"
cleanup() { rm -f "$CLI_JSON" "${NORMALIZED:-}"; }
trap cleanup EXIT

set +e
(cd "$REPO_ROOT/cli" && bun run tools:unpack && bunx vitest run --reporter=default --reporter=json --outputFile.json="$CLI_JSON")
set -e

if [[ ! -s "$CLI_JSON" ]]; then
    echo "ERROR: cli test run produced no JSON report (a setup step likely failed before vitest ran) — hard failure, not quarantine-eligible" >&2
    exit 1
fi

NORMALIZED="$(mktemp -t flaky-quarantine-results-XXXXXX.json)"
bun "$HERE/flaky-quarantine.mjs" from-vitest-json "$CLI_JSON" --package cli >"$NORMALIZED"
bun "$HERE/flaky-quarantine.mjs" check --results "$NORMALIZED" --registry "$REPO_ROOT/config/flaky-quarantine.yaml"
