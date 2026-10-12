# Exit reflection: cursor-mcp-isolation (#1613)

> Space-relief cleanup (volumes); not Gate A merged-soup. Tip still OPEN upstream.

## Shipped as

- PR(s): tiann/hapi#1613 (OPEN) — `fix/cursor-mcp-overlay-isolation` tip `957a3d00a`
- Absorber: n/a
- Session: [Dogfood2: MCP isolation #1613](/sessions/3a5d0e18-3ac6-4a20-9670-d97139597d10)

## Non-code residue

- Project mailbox key must stay bare `hapi` — unique `hapi-<uuid>` user keys were the multiplex bug this PR kills.
- Soup layer still live in `config/driver-manifest.yaml` until #1613 merges (space relief removed worktree only).
- Related stack still open: `fix/cursor-spawn-auto-worktree` (#195) sits on isolation in soup.
- Volumes space sweep 2026-10-12: worktree removed (~1.8G); branch kept on origin for open PR.
- Earlier #1473 fortress dogfood / Meta settle was a different remit; this session stood down on that path.

## Promote?

- [x] `none` — no durable follow-up beyond keeping soup until #1613 merges

## Open questions / landmines

- Do not drop soup while #1613 OPEN — driver still serves the layer; remat would regress to unique `hapi-<uuid>` unless tip is folded upstream.

## Skip

n/a — space-relief exit with open PR noted above.
