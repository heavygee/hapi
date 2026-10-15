# Flaky-test quarantine

## Why this exists

Two unrelated pieces of work were held hostage by red lights nobody could fix
locally (2026-10-15): [PR #222](https://github.com/heavygee/hapi/pull/222)
blocked on iOS `app-build` failing 3 different ways on a diff that never
touches the failing screens ([#273](https://github.com/heavygee/hapi/issues/273)),
and the #270 idle-gate remat tripped by `agentCliGuard.test.ts` under
full-suite timing ([#274](https://github.com/heavygee/hapi/issues/274)). Each
time, an agent escalated to the operator for a judgement call on a test it
didn't write. A tolerated red light teaches everyone that red doesn't really
mean red — this is the fix.

**A quarantined test still runs and still reports.** This is a tracked
quarantine, not an ignore list: every entry has an owner, an open issue, a
captured failure signature, and an expiry. Nothing here hides a test from CI
output; it only decides whether a *known* failure may be excused for
gate-pass purposes.

## The three rules

1. **Known id + matching failure signature → excused (non-blocking).**
2. **Known id + a DIFFERENT signature → BLOCKS.** Id-matching alone can't
   tell "the same old flake" from "a new bug that landed in the same test" —
   comparing the failure text closes most of that gap. A warning nobody must
   act on is exactly the mechanism that trained everyone to ignore red in the
   first place, so a mismatch blocks rather than warns.
3. **An expired entry excuses nothing.** It is not a grace period — the
   entry drops out of the active set, and the next failure under that id is
   an ordinary blocking failure until someone renews (with a reason) or
   removes it.

Plus a **ceiling** (default 8) on the number of active entries: past it, the
gate fails regardless of whether today's tests pass, until the registry is
cleaned up. The count is a forcing function, not a decoration.

## Where the data lives

`config/flaky-quarantine.yaml` — one file, read by both consumers (the local
remat gate and CI), so they cannot drift onto different lists. Field
reference and evidence bar are documented in the file's own header comment.

**Fork-only data; generic mechanism.** The YAML's content (which tests, which
issues, which owners) is specific to `heavygee/hapi`'s own CI observations.
The code that reads it (`scripts/tooling/flaky-quarantine.mjs` +
`scripts/tooling/lib/flaky-quarantine-core.mjs`) is generic — any repo with
CI would want it — and is a candidate for an eventual standalone/upstream
extraction. Don't let fork-specific assumptions leak into the script.

## How it's wired

```
                      config/flaky-quarantine.yaml
                        /                        \
   scripts/tooling/flaky-quarantine-gate.sh      ios/scripts/test-transcript.sh
     (hapi-driver-rebuild.sh --verify,             (ios.yml — DRAFTED, not yet
      .github/workflows/test.yml)                   applied; see below)
```

- **cli (vitest):** `flaky-quarantine-gate.sh <repo-root>` runs hub/web/
  shared/relay exactly as before (unchanged, fully blocking), then runs
  `cli`'s tests via `vitest run --reporter=default --reporter=json
  --outputFile.json=...`, converts the JSON report
  (`flaky-quarantine.mjs from-vitest-json`) and feeds it to
  `flaky-quarantine.mjs check`. Same script, called from both
  `hapi-driver-rebuild.sh`'s `--verify` test step and
  `.github/workflows/test.yml`'s `test` job (fork-only — upstream and other
  forks keep plain `bun run test`, see the `github.repository_owner` guard in
  that file).
- **iOS (XCTest):** `flaky-quarantine.mjs from-xcodebuild-log` parses
  xcodebuild's `error: -[Class method] : <message>` failure lines into the
  same normalized `{id, failed, message}` shape, proven against the three
  real PR #222 attempt logs (`ios:<TestClass>/<testMethod>` ids). **Not yet
  wired into `ios/scripts/test-transcript.sh` / `ios.yml`** — this host has
  no macOS runner, so the actual shell integration (capturing xcodebuild's
  stdout, `bun` on the GitHub-hosted `macos-15` runner, which `ios.yml`
  doesn't currently set up at all) could not be executed or verified here.
  Wiring it blind into a live gating workflow risked turning a flake into a
  hard break. Apply + smoke-test on an actual macOS run before trusting it.

## Validating the registry

```bash
bun scripts/tooling/flaky-quarantine.mjs validate
```

Checks schema (owner/issue/signature/dates present and sane, renewal math
consistent with `renewal_count`), confirms every `issue` is still OPEN on
GitHub, and reports the active count against the ceiling. Exit 2 on any
failure — safe to run standalone in a lint step.

## Negative controls

`scripts/tooling/flaky-quarantine.test.sh` (picked up automatically by the
existing `tooling-tests` CI job, no workflow change needed) proves, with
synthetic fixtures, that the gate can actually go red three ways before
anyone trusts it to go green: a quarantined test failing with its known
signature does not block; the same id failing with a different signature
blocks; an expired entry blocks even with a matching signature. Plus schema
and ceiling checks.
