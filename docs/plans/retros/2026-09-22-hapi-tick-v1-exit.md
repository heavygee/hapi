# Exit reflection: hapi tick v1 (heavygee/hapi#159)

> Gate A' after fork merge. Cap: bullets only.

## Shipped as

- PR(s): heavygee/hapi#159 (squash `baf1893b6`)
- Absorber: n/a (fork-only; not opened on tiann/hapi)
- Session: PR #159 babysit (`fcd5b3c5-f11e-494f-b45c-1dddce9cc634`)

## Non-code residue

- Fork merge gate defaulted to `tiann/hapi` and blocked `docs/plans` + Codex quota-noise comments — fixed in `hapi-pr-merge-gate` before merge.
- Tip Codex mop stopped on usage limits; Meta Ready stayed OFF until operator steered fork merge anyway.
- Soup layer was for dogfood of `tooling/hapi-tick-v1`; remat never absorbed it (budget-gauge conflict mid-wave). Tick usable via PATH → mirror after fork-main land.
- Do not open upstream PR until a non-systemd backend seam exists (PR body blocker).
- Unit escaping: `$` only on Exec* lines, not `ConditionPathExists`.
- CLI `resolveHapiToolingRoot` must stay scoped to HAPI cwd (not walk to unrelated repos).

## Promote?

- [x] `none` — no durable follow-up (fork merge-gate fix already on main)

## Open questions / landmines

- After Gate A drop, driver soup will not carry tick until Meta remats a fork-main overlay or an upstream-shaped re-thin; PATH/mirror is the interim dogfood path.

## Skip

- n/a
