# Absorb upstream's lazy `runCli` dispatch (2026-11-09)

**Status:** open. Two upstream tests are **skipped on soup**, visibly, with this doc referenced from the skip comment: `cli/src/index.test.ts` → *"CLI entry point with an unwritable HAPI_HOME"* (`--help` / `--version`).

**This is a deliberate skip, not a deletion.** The fork's recent history has a silent-loss precedent (`1b4438be5` deleted resolve-by-`agentSessionId` during a conflict cleanup and nobody noticed for three days), so the rule is: never quietly drop an upstream test to go green. Skipping with the reason in the file and a tracking doc keeps it loud.

## What upstream guarantees and why it fails here

Upstream 0.34.4 added a guarantee: `hapi --help` and `hapi --version` must work when `HAPI_HOME` cannot be created (unwritable home, locked-down container). They deliver it structurally:

```
upstream  cli/src/commands/runCli.ts   61 lines   thin lazy dispatcher
soup      cli/src/commands/runCli.ts  298 lines   eager imports incl. @/ui/logger
```

The soup's version imports `@/ui/logger` at module scope. That reaches `cli/src/configuration.ts:139`:

```ts
export const configuration: Configuration = new Configuration()
```

whose constructor calls `mkdirSync(this.happyHomeDir, …)` (`:106`) and `mkdirSync(this.logsDir, …)` (`:110`). So merely importing the command graph creates `HAPI_HOME` — before any command runs, including `--help`.

**Note the singleton is identical in both trees** (`configuration.ts:139` matches upstream exactly). The difference is purely *when the graph gets imported*: upstream's `index.ts` → `main()` dynamically imports a thin `runCli`, which lazily imports the specific command; the soup's `runCli` pulls everything eagerly.

## Why it was not fixed in the merge

Taking upstream's 61-line `runCli.ts` would drop the fork's 237 lines of command registration — every fork-only CLI command. Re-registering those inside upstream's new lazy structure is feature work with its own test surface, not a conflict resolution, and doing it inside a merge is how the 11-05 loss happened.

## How to absorb it

1. Take upstream's `commands/runCli.ts` and `commands/help.ts` as the new skeleton.
2. Port each fork command registration into the lazy dispatch — the import must happen *inside* the command branch, not at module scope.
3. The acceptance test already exists: un-skip `describe('CLI entry point with an unwritable HAPI_HOME')` in `cli/src/index.test.ts` and delete the skip comment. If it passes, the absorb is complete; that is the whole gate.
4. Audit for other eager `@/ui/logger` or `configuration` imports on the `--help` path — anything reached at module scope re-breaks it.

## Related

The same merge kept the fork's try/catch backstop around `runCli()` in `index.ts` (an unhandled rejection would otherwise exit 0 — the silent-success class). Keep that when restructuring; it is fork-only and upstream's `main()` has no equivalent.
