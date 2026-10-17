# Deliberate fleet push - standalone personal hub chicken-egg bootstrap (#247)

**Status:** soup tip `42e160795` / artifact `hapi-soup-v2026.10.11-42e1607` live on oos (#247 + #248). `offer.releaseNotes` confirmed. **A standalone personal hub stays off the oos fleet** - do not register it there.

## Architecture (hub-local - confirmed)

`POST /api/fleet/push-upgrade`, `PUT /api/upgrade/machine-policies/:id`, and `POST /api/machines/:id/upgrade-runner` are **scoped to whichever hub you call**. They operate on machines registered to *that* hub's SyncEngine + RPC registry. There is no oos-centric path, no "must be a remote fleet runner under the soup kitchen," and no requirement that the target runner live on a different host than the hub.

So for a standalone personal hub (its own Tailscale front door):

| Do | Don't |
|----|-------|
| Upgrade **that hub's own** hub+runner in-place to tip `42e1607` | Register it as a machine on oos's hub |
| `PUT` / `POST` against that hub's Tailscale front-door `/api/...` | Point its runner `HAPI_HUB` / token at oos |
| Target that hub's **own** machine id (local runner already on that hub) | Fold it into estate fleet membership |

Local runner on the same host as the hub is fine - `upgradeMachineRunner` only needs the machine online with live `runner-self-upgrade` RPC, not "remote."

## What the tip binary must provide

After in-place swap, the standalone personal hub process must be the #247 build so those routes exist. Same single-exe tip also carries the runner.

**Artifact bytes for future pushes:** hub-artifact offers are served from the hub's local disk (`soup-artifacts/latest` → `NOTES.md` + platform binaries, mirrored into `upgrade-artifacts`). A standalone personal hub does **not** need to join oos; it needs a **copy of the tip tree** (or equivalent) under its own `/var/lib/hapi/soup-artifacts/` so *its* hub can hand the runner a download URL. Source of those bytes can be oos's publish dir or the GitHub Release for `hapi-soup-v…` - that is file transfer, not fleet enrollment.

## Bootstrap (self-contained on the standalone personal hub)

### 1. Get tip `hapi-soup-v2026.10.11-42e1607` onto the standalone personal hub

Same binary-swap you already proved twice:

1. Install linux single-exe from that tip as that hub's hub+runner binary.
2. Restart its `hapi-hub` + `hapi-runner` (patient/local - that instance's units, not oos).
3. Confirm its web/API is up and `GET /api/upgrade/offer` (authed) returns an offer from the new tip.

Also place the tip under its soup-artifacts (manifest + linux binary + `NOTES.md`, `latest` → tag) so the next deliberate push has bytes to serve. Do **not** change its runner to use oos's CLI token.

### 2. Opt the local runner into push-apply (on that hub)

```bash
# HUB = that instance's own Tailscale front door (https://…), not oos
HUB="$STANDALONE_HUB"
# machine id = that hub's local runner id from GET $HUB/api/machines

curl -X PUT "$HUB/api/upgrade/machine-policies/<local-machine-id>" \
  -H "Authorization: Bearer $STANDALONE_JWT" \
  -H 'content-type: application/json' \
  -d '{"policy":"auto"}'
```

Keep hub-wide `fleetUpgradePolicy=alert` (opt down from default `auto`, #292). Only that machine id gets effective `auto` (= apply when you push).

### 3. Deliberate push thereafter (still that hub)

```bash
curl -X POST "$HUB/api/fleet/push-upgrade" \
  -H "Authorization: Bearer $STANDALONE_JWT" \
  -H 'content-type: application/json' \
  -d '{"machineIds":["<local-machine-id>"]}'
```

Or one-shot: `POST $HUB/api/machines/<id>/upgrade-runner`.

### 4. Later tips

When oos publishes a new `hapi-soup-v*`: copy that tip tree onto the standalone personal hub's `soup-artifacts` (and/or swap the single-exe), then `push-upgrade` on **that hub's** API. Still no oos registration.

## What oos's hub is for

Estate fleet (homelab, Teemo, antevorta-when-joined, etc.). A standalone personal hub is a separate product instance that **consumes the same published tip artifacts**, not a machine row in oos's DB.

## Antevorta / Ian

Same **self-contained or estate-fleet** choice per host. Estate pets that should live under oos register there. Standalone personal hubs copy tip + push locally. Do not conflate the two.
