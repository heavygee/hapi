# Exit reflection: hapi-inline #369 PixelCopy ScreenshotProvider (PR #370)

## Shipped as

- PR(s): HeavyGee-Projects/hapi-inline#370 → tag **v0.18.1**
- Absorber: n/a
- Session: this peer (issue #369 implement)

## Non-code residue

- Nuzzle held remat on app-local WindowScreenshot until package tag; remat + drop fork is consumer follow-up (inline Nuzzle).
- First CI fail was changelog embed drift after Unreleased edit — re-ran `npm run changelog:embed`.
- Gate merged release-please #368 for the tag; peer waited on that cut before Nuzzle ping.

## Promote?

- [x] `none` — lesson is already implied by #303 embed tests; no AGENTS row needed

## Open questions / landmines

- Consumers must wire `WindowScreenshot.capture(activity)` on remat — docs alone do not rewrite app `ScreenshotProvider` lambdas.

## Skip

n/a
