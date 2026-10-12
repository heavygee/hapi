# Exit reflection: local-followup-queue (#1686)

## Shipped as

- PR(s): none (never opened; dogfood never greenlit)
- Absorber: n/a
- Session: Peer #1686 local follow-up abort / `fix/local-followup-queue` tip `f2f12bdf5`

## Non-code residue

- Live reporter wipe was remote Abort, not local `doSwitch` — tracked as #1687
- #1686 CLOSED 2026-09-14 pending verification (not claimed fixed)
- Soup layer dropped 2026-10-12 for `/work` space relief (volumes)
- Tip still on origin history until GC; branch deleted

## Promote?

- [x] `none` — no durable follow-up; re-open issue + thin tip if local TUI repro returns

## Open questions / landmines

- If dogfood later needs the CLI change, revive from `f2f12bdf5` — do not assume soup still carries it

## Skip

- n/a (short reflection for unmerged space-relief cleanup)
