# Exit reflection: remote-claude-abort (#1687)

## Shipped as

- PR(s): none (parked pre-dogfood; no PR by remit)
- Absorber: n/a
- Session: Peer #1687 / space-relief cleanup from volumes
- Branch preserved: `origin/fix/remote-claude-abort-on-send` @ `fc7af6577`

## Non-code residue

- Hub journal: queue `POST /messages` then separate `POST /abort` +3s/+9s (soup web PWA neighbors: hub-settings, upgrade/offer, kitchen-status)
- Resume bug: `claudeCheckSession` used symlink `session.path` (-home-) while Claude wrote under realpath (-work-)
- Abort client tagging (`x-hapi-surface: web` + journal) shipped on same commit for next dogfood

## Promote?

- [x] `none` — dogfood still owed before upstream PR; nothing to promote into AGENTS yet

## Open questions / landmines

- Why did soup PWA fire Abort 3–9s after queue send? Still UX/Escape vs intentional Stop — needs dogfood with `[abort] client=` journal line
- Branch is ~147 commits behind `upstream/main`; rebase before any PR

## Skip

- n/a (space relief; work preserved on origin, not discarded)
