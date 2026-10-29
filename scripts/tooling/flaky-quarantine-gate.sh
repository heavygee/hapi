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
# Honor an inherited $BUN (hapi-driver-rebuild.sh resolves "${BUN:-$HOME/.bun/bin/bun}"
# but does not export it — callers must pass it through explicitly, e.g.
# `BUN="$BUN" bash flaky-quarantine-gate.sh ...`). Falling back to bare `bun`
# only works when it happens to be on PATH, which the caller's own fallback
# does not guarantee (cold review, 2026-10-15).
BUN="${BUN:-bun}"

run_plain() {
    echo "Running $1 tests..."
    (cd "$REPO_ROOT/$1" && "$BUN" run test)
}

run_plain hub
run_plain web
run_plain shared
run_plain relay

# Whole-registry health (ceiling + schema + issue-open-ness) is its OWN gate,
# run once, clearly attributed — NOT folded into the package-scoped `check`
# below. Without this split, an unrelated package's entry going bad (e.g. an
# `ios:` issue getting closed) would fail THIS cli-only run for a reason that
# has nothing to do with cli, which is exactly the cross-package coupling the
# --package flag on `check` exists to avoid. The ceiling itself is
# deliberately whole-registry (not per-package) — see flaky-quarantine.mjs.
echo "Validating quarantine registry (whole-file: ceiling + schema + issue-open)..."
if ! "$BUN" "$HERE/flaky-quarantine.mjs" validate --registry "$REPO_ROOT/config/flaky-quarantine.yaml"; then
    echo "ERROR: config/flaky-quarantine.yaml itself is invalid or over ceiling — fix the registry before any gate can trust it." >&2
    exit 1
fi

echo "Running cli tests (quarantine-aware)..."
CLI_JSON="$(mktemp -t flaky-quarantine-cli-XXXXXX.json)"
cleanup() { rm -f "$CLI_JSON" "${NORMALIZED:-}"; }
trap cleanup EXIT

set +e
(cd "$REPO_ROOT/cli" && "$BUN" run tools:unpack && "$BUN" x vitest run --reporter=default --reporter=json --outputFile.json="$CLI_JSON")
VITEST_RC=$?
set -e

if [[ ! -s "$CLI_JSON" ]]; then
    echo "ERROR: cli test run produced no JSON report (a setup step likely failed before vitest ran, exit $VITEST_RC) — hard failure, not quarantine-eligible" >&2
    exit 1
fi

NORMALIZED="$(mktemp -t flaky-quarantine-results-XXXXXX.json)"
"$BUN" "$HERE/flaky-quarantine.mjs" from-vitest-json "$CLI_JSON" --package cli >"$NORMALIZED"
# --runner-exit-code: a JSON report CAN exist (vitest wrote it) while vitest
# itself still exited non-zero with zero attributable per-test failures — a
# collection/import error or zero tests discovered. Without passing this
# through, that failure mode would silently normalize to an empty results
# list and the gate would report a clean pass (cold review, 2026-10-15).
"$BUN" "$HERE/flaky-quarantine.mjs" check --results "$NORMALIZED" --package cli --registry "$REPO_ROOT/config/flaky-quarantine.yaml" --runner-exit-code "$VITEST_RC"
