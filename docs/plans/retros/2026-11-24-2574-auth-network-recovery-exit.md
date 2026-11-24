# Exit reflection: 2574-auth-network-recovery (PR #2579)

## Shipped as

- PR(s): tiann/hapi#2579 (merged `a2a79b4a6`, tip `17015f203`)
- Absorber: n/a
- Session: /sessions/71d7ec9d-21d3-44aa-8fe7-08a279db0e70

## Non-code residue

- Green PR head / red `main` was squash-onto-moved-base: #2519 + #2564 incompatible only in merge order; pre-merge check cannot catch that class.
- Issue #2574's bot guessed `online`/`setOffline`+clock; `:257` has no clock - collapsed `/fixture` folder after #2564 unread-peek removal was the real mechanism.
- CI traces still undebuggable without artifact upload (Meta filed heavygee/hapi#343 separately).
- Session sat ~19h post-merge without Gate A' because Meta's "stop after green" brief omitted the MERGED cleanup paste, and 🔧-archive-pending is not hourly-pinged.

## Promote?

- [x] `none` — asymmetry class already said out loud on #2579; fold coverage lives on #2520

## Open questions / landmines

- Archive-pending peers after "stop at green" need an explicit MERGED cleanup ping or they rot until a human asks.

## Skip

- n/a
