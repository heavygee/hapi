# Deliberate fleet push - ninja chicken-egg bootstrap (#247)

**Status:** soup tip `96071c14b` / artifact `hapi-soup-v2026.10.11-96071c1` published. Meta patient hub restart drains WORKING (oos kitchen). **Ninja stays a standalone hub** - do not register it into the oos fleet.

## Architecture (hub-local - confirmed)

`POST /api/fleet/push-upgrade`, `PUT /api/upgrade/machine-policies/:id`, and `POST /api/machines/:id/upgrade-runner` are **scoped to whichever hub you call**. They operate on machines registered to *that* hub's SyncEngine + RPC registry. There is no oos-centric path, no "must be a remote fleet runner under the soup kitchen," and no requirement that the target runner live on a different host than the hub.

So for Miss Ninja's gift box (`hapi.quetzal-ghoul.ts.net`):

| Do | Don't |
|----|-------|
| Upgrade **ninja's own** hub+runner in-place to tip `96071c1` | Register ninja as a machine on oos's hub |
| `PUT` / `POST` against `https://hapi.quetzal-ghoul.ts.net/api/...` | Point ninja's runner `HAPI_HUB` / token at oos |
| Target ninja's **own** machine id (local runner already on that hub) | Fold ninja into estate fleet membership |

Local runner on the same host as the hub is fine - `upgradeMachineRunner` only needs the machine online with live `runner-self-upgrade` RPC, not "remote."

## What the tip binary must provide

After in-place swap, ninja's hub process must be the #247 build so those routes exist. Same single-exe tip also carries the runner.

**Artifact bytes for future pushes:** hub-artifact offers are served from the hub's local disk (`soup-artifacts/latest` → `NOTES.md` + platform binaries, mirrored into `upgrade-artifacts`). Ninja does **not** need to join oos; it needs a **copy of the tip tree** (or equivalent) under its own `/var/lib/hapi/soup-artifacts/` so *its* hub can hand the runner a download URL. Source of those bytes can be oos's publish dir or the GitHub Release for `hapi-soup-v…` - that is file transfer, not fleet enrollment.

## Bootstrap (self-contained on ninja)

### 1. Get tip `hapi-soup-v2026.10.11-96071c1` onto ninja

Same binary-swap you already proved twice:

1. Install linux single-exe from that tip as ninja's hub+runner binary.
2. Restart ninja's `hapi-hub` + `hapi-runner` (patient/local - ninja's units, not oos).
3. Confirm ninja web/API is up and `GET /api/upgrade/offer` (authed) returns an offer from the new tip.

Also place the tip under ninja's soup-artifacts (manifest + linux binary + `NOTES.md`, `latest` → tag) so the next deliberate push has bytes to serve. Do **not** change ninja runner to use oos's CLI token.

### 2. Opt the local runner into push-apply (on ninja's hub)

```bash
HUB=https://hapi.quetzal-ghoul.ts.net
# machine id = ninja's local runner id from GET $HUB/api/machines

curl -X PUT "$HUB/api/upgrade/machine-policies/<local-machine-id>" \
  -H "Authorization: Bearer $NINJA_JWT" \
  -H 'content-type: application/json' \
  -d '{"policy":"auto"}'
```

Keep ninja hub-wide `fleetUpgradePolicy=alert` (or leave default). Only that machine id gets effective `auto` (= apply when you push).

### 3. Deliberate push thereafter (still ninja's hub)

```bash
curl -X POST "$HUB/api/fleet/push-upgrade" \
  -H "Authorization: Bearer $NINJA_JWT" \
  -H 'content-type: application/json' \
  -d '{"machineIds":["<local-machine-id>"]}'
```

Or one-shot: `POST $HUB/api/machines/<id>/upgrade-runner`.

### 4. Later tips

When oos publishes a new `hapi-soup-v*`: copy that tip tree onto ninja's `soup-artifacts` (and/or swap the single-exe), then `push-upgrade` on **ninja's** API. Still no oos registration.

## What oos's hub is for

Estate fleet (homelab, Teemo, antevorta-when-joined, etc.). Ninja is a separate product instance that **consumes the same published tip artifacts**, not a machine row in oos's DB.

## Antevorta / Ian

Same **self-contained or estate-fleet** choice per host. Estate pets that should live under oos register there. Gift/standalone hubs copy tip + push locally. Do not conflate the two.
