# Garden (operator fork)

XR agent garden POC — **not** upstream HAPI canon. Lives on branch `garden/r3f-poc`.

## Where

| Checkout | Path | Branch | Owner |
|----------|------|--------|-------|
| Upstream / voice PRs | `~/coding/hapi` | `fix/*`, etc. | Claude |
| **Garden** | `~/coding/hapi-garden` | `garden/r3f-poc` | Garden agent |

This directory is a **git worktree** (same `.git` as `hapi`, separate working tree).

## Run

```bash
cd ~/coding/hapi-garden
bun install
bun run dev          # hub + web
```

Open **`/garden`**. HUD build stamp is `GARDEN_BUILD` in `web/src/garden/utils/sessionVisuals.ts` (currently `r3f-v2`).

## Deploy / seeing new builds

The hub serves **`web/dist`**. Editing source does **not** update what Quest/browser loads until you rebuild:

```bash
cd ~/coding/hapi-garden/web
bun run build
# restart hub (or full `bun run dev` restart)
```

Hard-refresh or clear PWA cache if the stamp is stale. If HUD still shows an old stamp, you are on an old bundle.

## Docs

- `docs/plans/garden-vr-testing-strategy.md` — test pyramid
- `docs/plans/2026-05-24-xr-multi-agent-workstation-vision.md` — product vision

## Tests

```bash
cd web && bun run test src/garden
```
