# Directory-scoped Claude auth profiles — spike handoff (2026-09-08)

**Ask:** `~/coding/sparling` (Teams-billed account) must authenticate separately from the
host's ambient Claude login when HAPI spawns sessions there. Soup-first; upstream PR is a
stretch goal, not filed.

## What shipped

Thin tip: `feat/dir-auth-profiles` @ `e2bce00ce` (single commit on `upstream/main`,
worktree `~/coding/hapi/worktrees/dir-auth-profiles`) — upstream-PR-shaped.
Soup union: `driver/dir-auth-profiles` @ `7eb7d60fc` (worktree `~/coding/hapi/worktrees/dir-auth-soup`),
last layer in `config/driver-manifest.yaml`.

`~/.hapi/settings.json`:

```json
{ "directoryAuthProfiles": [ { "pathPrefix": "~/coding/sparling", "claudeCodeOAuthToken": "sk-ant-oat01-..." } ] }
```

- `cli/src/runner/spawnAuth.ts` (new) — `resolveDirectoryAuthToken` (pure, longest-prefix,
  segment-aware) + `buildSpawnAuthEnv` (the token→env construction, moved out of `run.ts`
  verbatim, Codex `CODEX_HOME` branch unchanged).
- `cli/src/runner/run.ts` — the inline `if (options.token)` block becomes one
  `buildSpawnAuthEnv({...})` call. Also redacts `options.token` from the spawn debug log.
- `cli/src/persistence.ts` — `directoryAuthProfiles?` on `Settings`.
- `cli/src/ui/doctor.ts` — redacts profile tokens from `hapi doctor` (path prefixes stay visible).
- `docs/public/schemas/settings.schema.json` — the published schema is
  `additionalProperties: false`, so the field had to be declared there or a configured
  settings.json would be schema-invalid.
- `cli/src/runner/README.md` — operator-facing docs.

Precedence: explicit per-spawn token (hub/mobile) > directory profile > ambient login.
Claude only. Paths compared literally (no symlink resolution) — documented in the module.

## Proof

- `bun typecheck` (cli/web/hub/relay) and `bun run test` (cli: 2524 passed) green on the thin
  tip; union tip typechecks and passes the touched suites.
- 21 new unit tests in `cli/src/runner/spawnAuth.test.ts` (longest-prefix, sibling
  false-positive guard, `~` expansion, relative-prefix rejection, malformed entries,
  explicit-token override, non-Claude agents, and the unconfigured no-op invariant),
  plus 2 in `doctor.test.ts`.
- `hapi-driver-rebuild --build-web --verify` exit 0 — layers+heals OK, atomic web swap,
  `verify-soup-web-dist` OK, session open + send smokes OK, 264+322 test files passed,
  patient hub+runner restart.
- **Live dogfood on the promoted soup** (scratch profile, removed afterwards): session spawned
  at the matching prefix received the profile token in `/proc/<pid>/environ`; a session spawned
  at the sibling `-old` directory received the runner's ambient token instead. Verified by
  hashing the env line, not printing it. Scratch profile removed — `~/.hapi/settings.json`
  diffs identical to its pre-dogfood state.

## Open / next

- No upstream issue or PR filed (operator's call). The thin tip is already shaped for one.
- Union layer needs a re-thin after the next dogfood bump (noted in the manifest comment).
- Two stopped scratch sessions (`b5a74fae…`, `4a8b70bf…`) remain as hub rows; harmless.
