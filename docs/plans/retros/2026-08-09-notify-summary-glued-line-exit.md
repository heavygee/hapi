# Exit reflection: notify-summary-glued-line (PR #1426)

## Shipped as

- PR(s): tiann/hapi#1426 (Fixes #1425)
- Absorber (if superseded): n/a
- Session: 642e4ff6-9d08-4de0-80e1-7f8d1f93fcf2

## Non-code residue

- Rebuild reads `config/driver-manifest.yaml` (canonical), not `~/.config` alone - first remat missed the layer.
- Soup already had collapse-tolerant `matchNotifySummaryLine`; upstream tip conflicted → needed `driver/` union tip for :3006.
- HAPI Bot Minor was real: `lastIndexOf(token)` breaks when a JSON string value mentions the token; left-to-right + `JSON.parse` gate.
- Lane B: product path (`shared/`) needed explicit `low-impact` + operator merge direction (not auto-B).

## Promote?

- [x] `none` — no durable follow-up
- [ ] `High-signal index` — one row for `docs/operator/AGENTS.md` (paste proposed row)
- [ ] `lifecycle / tooling doc` — path + one-line change
- [ ] `tooling issue` — title + why (file or link)

## Open questions / landmines

- n/a (manifest path already documented in `driver-soup.md`)

## Skip

- n/a
