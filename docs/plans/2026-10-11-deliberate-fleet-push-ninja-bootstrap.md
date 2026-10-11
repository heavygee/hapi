# Deliberate fleet push - ninja chicken-egg bootstrap (#247)

**Status:** layer `driver/247-deliberate-fleet-push` @ `f5c3933b6` pushed; waiting remat + soup tip publish.

## What landed (code)

- Hub default `fleetUpgradePolicy` stays `alert` (live settings already flipped; unattended keepalive auto is gone).
- Restored `POST /api/machines/:id/upgrade-runner`.
- New `POST /api/fleet/push-upgrade` `{ machineIds, forceAlert? }`.
- Per-machine overrides: `GET/PUT /api/upgrade/machine-policies[/:machineId]` (`auto|alert|silent|null`).
- Effective `auto` means "apply on deliberate push", not keepalive.

## Chicken-egg: what ninja needs first

Per-machine `auto` is **hub-side**. The runner only needs `runner-self-upgrade` (+ online RPC registration) to honor a push. Bootstrap order:

### 1. Hub soup tip with #247 (oos primary)

Remat absorbing `driver/247-deliberate-fleet-push` @ `f5c3933b6`, then patient hub restart so live `:3006` serves:

- `POST /api/machines/:id/upgrade-runner`
- `POST /api/fleet/push-upgrade`
- machine-policy routes

Published single-exe tag will look like `hapi-soup-vYYYY.MM.DD-<7char>` under `/var/lib/hapi/soup-artifacts/` (and `latest` symlink). **That tip is the bootstrap binary for ninja.**

### 2. Ninja first install (manual - once)

If ninja is not yet a hub machine, or lacks `runner-self-upgrade`:

1. Copy the **linux** single-exe from the published tip (oos → ninja), install as fleet binary (`/opt/hapi/hapi` or host convention in `docs/tooling/systemd-install.md` fleet-binary path).
2. Point ninja runner at the oos hub (CLI token / machine register) and start the unit.
3. Confirm machine appears online with capability `runner-self-upgrade`.

Do **not** flip hub-wide policy to `auto`.

### 3. Opt ninja into push-apply

```bash
# hub JWT / cookie as operator
curl -X PUT "$HUB/api/upgrade/machine-policies/<ninja-machine-id>" \
  -H 'content-type: application/json' \
  -d '{"policy":"auto"}'
```

Hub default remains `alert`; only ninja effective policy is `auto`.

### 4. Deliberate push thereafter

```bash
curl -X POST "$HUB/api/fleet/push-upgrade" \
  -H 'content-type: application/json' \
  -d '{"machineIds":["<ninja-machine-id>"]}'
```

Or one-shot without machine auto: `POST /api/machines/<id>/upgrade-runner`.

### Shortcut if ninja already has `runner-self-upgrade`

After hub remat only: skip binary scp; use banner / `upgrade-runner` once to pull the new tip, then set machine policy `auto` and use `push-upgrade` for later tips.

## Antevorta / Ian

Same recipe after ninja proves push → auto-respond. Keep hub default `alert`; grant per-machine `auto` only for hosts under deliberate test.
