# Upstream absorb replay list — fork main <- upstream/main
# started: 2026-11-18  owner: tooling_meta cbd1073e (meta-sessions.yaml: local kitchen / remat owner)
# base: origin/main 8816ad9b6   upstream/main: 597c5ab22
# gap: 110 behind / 1552 ahead at start
# handbook: docs/operator/tooling-meta-role.md §3b
#
# status per file: PENDING -> RESOLVED
RESOLVED .github/workflows/test.yml                              hunks=2
RESOLVED  cli/src/claude/claudeLocalLauncher.test.ts              hunks=1
RESOLVED  cli/src/claude/claudeRemoteLauncher.test.ts             hunks=1
RESOLVED  cli/src/claude/utils/claudeCheckSession.ts              hunks=2
RESOLVED  cli/src/codex/utils/buildHapiMcpBridge.test.ts          hunks=3
RESOLVED  cli/src/commands/registry.ts                            hunks=2
RESOLVED  cli/src/cursor/cursorAcpRemoteLauncher.ts               hunks=1
RESOLVED docs/.vitepress/config.ts                               hunks=1
RESOLVED hub/README.md                                           hunks=1

## Outcome
All 9 resolved. Gate: `typecheck:cli` clean; registry smoke PASS (positive +
negative control). `typecheck:hub` reports 6x TS2307 only — `@simplewebauthn/server`
and `reflect-metadata` are NEW upstream deps declared in the merged
hub/package.json but not installed in the mirror (mirror-hygiene guard forbids
`bun install` there). Not merge defects; the remat WT installs its own deps.

## Silent auto-merge caught by tsc, not by git
Two files merged with NO conflict and were still wrong:
- `claudeRemoteLauncher.modeGate.test.ts` — `getMetadata` added by both sides,
  duplicate object key.
- `cursorAcpRemoteLauncher.test.ts` — upstream added `sendSessionEvent.mock`
  assertions; the fork's narrower cast won the merge, so `.mock` did not exist.
This is the class §3b warns about: git has no overlapping lines to conflict on.

## Landmines (predecessor 028d0a86 was right on all three)
1. `registry.ts` — upstream replaced the eager array with a lazy commandMap and
   its map has NO `search-content`. `--theirs` would have deleted a served CLI
   command while typechecking clean. Added as a lazy entry; smoke proves it.
2. `buildHapiMcpBridge.test.ts` — fork `search_content` vs upstream `link_pr`;
   either side alone silently drops a tool from the contract test. Unioned in
   startHappyServer.ts push order.
3. `test.yml` — upstream's job graph adopted, fork self-hosted selectors and the
   flaky-quarantine gate re-applied. Gate job left GitHub-hosted on purpose so a
   runner outage fails loudly instead of never reporting.
