# Peer briefing: optional "In progress" session section

> **Date:** 2026-08-03
> **Worktree:** `~/coding/hapi/worktrees/in-progress-optional`
> **Branch:** `feat/in-progress-section-optional` (from `upstream/main`, includes #1315)

## Operator request (verbatim intent)

From [tiann/hapi#1315 comment](https://github.com/tiann/hapi/pull/1315#issuecomment-5165842767) by @heavygee:

> The problem with this change, is that if you have a lot of sessions open, across many projects, it now becomes harder to differentiate between them.
>
> Before - you could see "at a glance" where an active agent belonged because it was included in their working directory set.
>
> Now - you have to review the small "working/directory" texts that live below the session titles, to understand what the work is connected to. it's now more work than it used to be :/
>
> I'm struggling to see how the existing "only show active sessions" didn't already suffice - with that enabled, you would get a likely small collection of active sessions, grouped by their working directory.
>
> I think I will try adding an option next to that existing "only show active session" that will turn this from a default, to an optional toggle.

## Desired behavior

1. **Default OFF:** do **not** pin active sessions into a separate "In progress" section. Active sessions stay inside their **directory/project groups** (pre-#1315 glanceability).
2. **Optional ON:** Settings → Display, **next to** "Active sessions only", add a toggle e.g. **"Pin in-progress sessions"** / **"Group in-progress at top"** that restores #1315 pinned section behavior when enabled.
3. The two toggles are independent:
   - Active-only = filter list to active (+ selected exception)
   - Pin in-progress = whether actives are pulled out of directory groups into the pinned section
4. Persist via localStorage, mirror `useShowActiveSessionsOnly` pattern (cross-tab `storage` sync).
5. Locales: `en` + `zh-CN`.
6. Update `SessionList` tests for both modes.

## Upstream issue first

File a new issue on `tiann/hapi` that:

- References #1315 and the operator comment URL
- Explains the UX regression (directory grouping lost for actives)
- Proposes the optional toggle (default off)
- Notes coexistence with existing "Active sessions only"

Then implement against that issue (`Fixes #N` in the eventual PR).

## Lifecycle (mandatory)

Read:

- `docs/tooling/feature-work-lifecycle.md` (sole workflow)
- `docs/tooling/new-feature-intake.md` §6 gates

Path:

1. Issue upstream
2. Implement in this worktree only (no hand-edit `driver/`)
3. `bun typecheck` + focused tests
4. Peer-stack Playwright proof + **inline** images into HAPI chat (`display_image` / `hapi-display-image.mjs`)
5. **Always soup-promote** for `:3006` dogfood (`hapi-driver-status --quiet` first; add manifest layer; rebuild with `--build-web`; never stack-switch from agent shell)
6. Operator dogfood on `:3006` before opening upstream PR
7. After operator OK: upstream PR from this branch; attach with `hapi link-pr`; title = workstream only (no status emoji / no `PR #N:` once chipped)

## Key files (on soup / this tip)

- `web/src/components/SessionList.tsx` — pinned "In progress" section
- `web/src/hooks/useShowActiveSessionsOnly.ts` — pattern to copy
- `web/src/routes/settings/display.tsx` — place new switch beside active-only
- `web/src/lib/locales/{en,zh-CN}.ts`
- `web/src/components/SessionList.directory-action.test.tsx`

## Do NOT

- Merge on `tiann/hapi`
- Hand-edit `~/coding/hapi/driver`
- Skip soup promotion
- Put ✅/🔁/⚠️/📝/🔧 or `PR #N:` in the session title once chipped
- Change default of "Active sessions only" (stays default off)
