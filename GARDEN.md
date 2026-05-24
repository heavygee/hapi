# Garden (operator fork)

XR agent garden POC — **not** upstream HAPI canon. Branch: `garden/r3f-poc`.

## Two checkouts, two URLs

| | **HAPI (Claude)** | **Garden (XR POC)** |
|--|-------------------|---------------------|
| Code | `~/coding/hapi` | `~/coding/hapi-garden` |
| Branch | `fix/*`, upstream PRs | `garden/r3f-poc` |
| Tailnet | **`https://hapi.tail9944ee.ts.net/`** | **`https://garden.tail9944ee.ts.net/garden`** |
| Default port | hub **3006** (systemd) | web **5174** (vite dev) |
| Database | `~/.hapi` | *shared* in dev (see below) |

Worktrees = separate git trees. **Tailnet + ports** = separate runtime. You can run both at once.

## Recommended: shared API (both live)

Garden UI on **5174**, but **sessions/auth/API** come from Claude's hub on **3006**. Same agents, same login token, no second SQLite file.

**Terminal 1 — already running via systemd:**

```bash
systemctl status hapi-hub.service   # :3006
```

**Terminal 2 — Garden web only:**

```bash
cd ~/coding/hapi-garden
bun run dev:shared
```

Open **`https://garden.tail9944ee.ts.net/garden`** (after Tailscale Serve; see below).

Quest flow: Garden page loads from `:5174` → `/api` proxied to `:3006` → real sessions as orbs.

## Isolated mode (separate hub + DB)

Only when you want a sandbox with no shared sessions:

```bash
cp scripts/dev/garden-hub.env.example hub/.env   # set ELEVENLABS_API_KEY
bun run dev:isolated           # hub :3007, web :5175, ~/.hapi-garden
```

Point `GARDEN_PORT=3007` at Tailscale Serve if using built `web/dist` from isolated hub.

## Tailscale: `garden.tail9944ee.ts.net` (one-time)

From `~/coding/server-setup`:

```bash
chmod +x scripts/tailscale/harden-garden-service.sh scripts/tailscale/serve-garden.sh scripts/tailscale/install-garden-tailnet-services.sh scripts/verify-garden-tailnet.sh
./scripts/tailscale/harden-garden-service.sh
sudo ./scripts/tailscale/install-garden-tailnet-services.sh
./scripts/verify-garden-tailnet.sh
```

Requires **`bun run dev:shared`** (or something listening on **5174**) before serve health-check passes.

**Do not** repoint `svc:hapi` — leave Claude's hub alone.

## Build stamp / deploy

Source stamp: `GARDEN_BUILD` in `web/src/garden/utils/sessionVisuals.ts` (e.g. `r3f-v2`).

- **`dev:shared`**: stamp updates on save (vite HMR).
- **Production bundle**: `cd web && bun run build` — only needed for isolated hub serving `dist/`.

If HUD shows an old stamp, you're on an old process or cached PWA — not a missing "install", a missing **restart/rebuild**.

## Tests

```bash
cd web && bun run test src/garden
```

## Docs

- `docs/plans/garden-vr-testing-strategy.md`
- `docs/plans/2026-05-24-xr-multi-agent-workstation-vision.md`
