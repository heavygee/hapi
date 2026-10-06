# Exit reflection: bracket Cursor model remap (PR #1430)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): https://github.com/tiann/hapi/pull/1430 (merge `fe4d51043`)
- Issue: https://github.com/tiann/hapi/issues/1428
- Absorber: n/a
- Session: `/sessions/ca2ad51b-d366-4233-9173-8b8d293a4a98`

## Non-code residue

- Bracketed Cursor wires (`model[param=…]`) survive in session state after catalog goes bare-only; `#1271` grok remap was too narrow - need broad wire→bare/SKU + spawn restore fail-closed.
- Estate Meta chip `🔧` means **merged / cleanup owed**, not CI broken - peers must not treat wrench as "needs_work".
- Lane classifier used to short-circuit on `product_paths` → false "wait tiann"; retired 2026-08-09 (`5d23292bb`). Oversized focused fixes still need `low-impact`.
- Cold-review thrash: silent remap / restore-without-throw were real Majors; tip needed `throwOnFailure` when spawn remapped.

## Promote?

- [x] `none` — lane path-kind fix + AGENTS chip contract already landed; no new High-signal row
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`

## Open questions / landmines

- Live Cursor ACP catalog option values can still diverge from machine bare list - residual risk called out in bot Summary; watch dogfood on bracketed SKUs after remat.
- n/a otherwise

## Skip

- (not skipped)
