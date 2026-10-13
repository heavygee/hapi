# Fleet seal contract (hub upstream-seal subscriber)

**Status:** canon for implementers (ninja standalone hub + any future gift/personal hub).  
**Owner lane:** fleet / hub-runner-version governance.  
**Consumer:** `[ninjcow-incus upkeep](/sessions/ba76163e-d993-4b2b-b4ab-c4cdf3c41c7e)` and successors - **in-product hub code only**.  
**Related:** #247 deliberate push, #248 release notes, #251 per-machine auto keepalive, publish fix `44ef482d2` (stale binary).

## Product requirement (operator)

> I seal for the fleet → something is written to a known place → a **standalone HAPI hub** watching that place notices **new bytes** and updates itself.

Steady state is **not** agent SSH-and-copy, and **not** a companion bash/node poller beside HAPI. Estate pets on the oos hub already get offer + `auto` keepalive. Standalone hubs (ninja, gifts) need the same *discover* half as a **native hub capability** (`HAPI_UPSTREAM_SEAL_URL` or settings-equivalent), reusing digest-compare + materialize + existing offer/policy.

**Operator correction (2026-10-13):** do not bolt an additional moving part alongside HAPI. Feasibility ack: scoped addition (Layer A), not a redesign of offer/policy - see § Feasibility shape.

## Two pointers (do not conflate)

| Pointer | Moves when | Consumers |
|---------|------------|-----------|
| `latest` | Every successful soup single-exe **publish** (dogfood tip; remat thrash OK) | oos hub offer / estate dogfood only |
| `fleet-latest` | **Only** on operator **fleet seal** (`fleet seal` / `good enough for fleet` / `seal tip <tag>`) | Standalone hubs with upstream-seal configured **must** poll this |

If `fleet-latest` is absent, there is **no seal** yet - subscribers must not fall back to `latest` for auto-apply (that reintroduces tip thrash and the stale-tag class of lies). Human/agent bootstrap may still copy `latest` once by hand; that is not the contract.

**Tooling:** `hapi-fleet-seal [tag]` (scripts/tooling/hapi-fleet-seal.sh) points `fleet-latest` → tip and writes `fleet-latest-tag.txt` after verifying every `binaries[].sha256` matches on-disk files. Does **not** move dogfood `latest`. Spoken gate still required before agents run it.

## Poll locations (priority order)

### 1. Estate / tailnet (preferred when the subscriber hub can reach oos)

Root (foundry default):

```text
/var/lib/hapi/soup-artifacts/
```

Override: `HAPI_SOUP_ARTIFACTS_ROOT` / `HAPI_SOUP_ARTIFACTS`.

**Seal discovery (required once `fleet-latest` exists):**

```text
{artifactsRoot}/fleet-latest                 → symlink to tip dir
{artifactsRoot}/fleet-latest-tag.txt         → one line: hapi-soup-v…
{artifactsRoot}/fleet-latest/manifest.json   → schema below
{artifactsRoot}/fleet-latest/NOTES.md        → optional human notes
{artifactsRoot}/fleet-latest/<platform-dir>/hapi[.exe]
```

How a remote hub reaches that tree is transport (HTTP mirror of `manifest.json` + binaries, signed URL) - configure via `HAPI_UPSTREAM_SEAL_URL` pointing at the **manifest** (or a directory URL that resolves to it). Contract surface is the **files**, identical to local disk.

**Dogfood only (not for auto-apply on standalones):**

```text
{artifactsRoot}/latest
{artifactsRoot}/latest-tag.txt
```

### 2. Public fallback (no estate path)

GitHub Releases on **`heavygee/hapi`** (fork), tags `hapi-soup-v*`.

| File | Role |
|------|------|
| Release asset `manifest.json` | Same schema as on-disk tip |
| Release asset `NOTES.md` | Optional |
| `hapi-linux-x64-baseline`, `hapi-linux-arm64`, `hapi-darwin-arm64`, `hapi-darwin-x64`, `hapi-windows-x64.exe` | Binaries (names differ from on-disk paths; map via manifest `binaries[].path` ↔ release asset naming in publisher) |

**Seal tag selection (when seal pointer is mirrored to GH):** prefer a release that is annotated / titled as fleet-sealed, or a dedicated tag pointer release. Until that exists, **do not** treat `releases/latest` or "newest `hapi-soup-v*` by date" as seal - that is dogfood thrash + the stale-bytes failure mode.

Interim for GH-only hosts (documented escape, not the happy path): operator names the sealed tag once; hub then digests that release's `manifest.json` forever until the next named seal.

## Manifest format (already live)

Published tip `manifest.json` (`schema: 1`) is the contract body. Example fields (oos 2026-10-13):

```json
{
  "schema": 1,
  "tag": "hapi-soup-v2026.10.13-bc936f2",
  "composedTipSha": "bc936f291a27fae6399ce4abc35aded5877320b0",
  "composedTreeOid": "…",
  "layerCount": 69,
  "webDistIndexSha256": "…",
  "protocolVersion": 1,
  "publishedAt": "2026-10-13T10:12:55Z",
  "publisherHost": "oos-linux",
  "binaries": [
    {
      "target": "bun-linux-x64-baseline",
      "platform": "linux",
      "arch": "x64",
      "variant": "baseline",
      "path": "linux-x64-baseline/hapi",
      "sha256": "a03a381e8ccc24fff93d59e36f2e46c3922507a6ff632b989c0366cab6f6ba19",
      "sizeBytes": 149219456
    }
  ]
}
```

Subscriber **must** parse `schema`, `tag`, and `binaries[]`. Unknown higher `schema` → fail closed (do not apply).

Platform pick: match running OS/arch to one `binaries[]` entry (`platform` + `arch` + `variant` as needed). Linux x64 pets use `linux-x64-baseline`.

## Non-negotiable: digest-based change detection

**Newness = local installed (or staged) binary sha256 ≠ seal manifest entry sha256 for this platform.**

| Signal | Allowed as "new"? |
|--------|-------------------|
| Platform binary **sha256** differs from on-disk / running binary | **Yes** - only hard newness |
| `tag` / `composedTipSha` / `publishedAt` / NOTES changed | **No** alone |
| GitHub release created / date newer | **No** alone |
| `fleet-latest` symlink retargeted but binary digest unchanged | **No** - refuse apply (same class as `44ef482d2` stale publish) |

After download: re-hash bytes; must equal `binaries[].sha256` or abort. Never trust tag, changelog, or "asset name matches."

Kill-criterion (from the week of stale `755936f5…` under rotating tags): a subscriber that upgrades when the **tag** changes but the **digest** does not is **non-compliant**.

## Feasibility shape (2026-10-13)

Honest split - do **not** claim "flip one env var and existing machinery Just Works":

| Layer | What | Scope |
|-------|------|-------|
| **A - discover** | Hub polls `HAPI_UPSTREAM_SEAL_URL` → digest-compare → materialize tip into **local** `soup-artifacts/` → retarget local pointer → existing `resolveCurrentUpgradeOffer` + #251 policy applies to **this hub's runners** | **Scoped addition.** Offer construction stays "local disk SoT"; remote seal is an *input*. No companion process. No policy-engine redesign. |
| **B - hub process apply** | Swap the hub's own binary (`process.execPath` / install path) + exit for systemd `Restart=always` / patient drain | **Real gap today.** Runners self-upgrade via RPC; hub process does not. Reuse `applyRunnerSelfUpgrade` primitives inside hub lifecycle - still in-product. Needed when standalone hub UI/API itself must move, not only its runners. |

**What "I am SoT" means today:** offer URLs are relative `/cli/upgrade/cli-artifact?…` served by this hub; policy targets registered machines. Correct subscriber model: **materialize remote seal locally first**, then this hub remains SoT for *its* runners. Do not leave offer URLs pointed at oos while ninja runners download through a proxy forever.

**Kill-criteria / friction:**

1. oos foundry must **not** set `HAPI_UPSTREAM_SEAL_URL` to itself (ouroboros).
2. Never auto-apply off dogfood `latest` / GH `releases/latest` - only `fleet-latest` / seal pointer.
3. Shared single-exe path: hub+runner on same binary → ordered apply; avoid rewriting a live hub exec mid-flight.
4. Hub restart under live sessions = patient drain, not `pkill`.

## Apply sequence (standalone hub - Layer A)

Once digest-new is proven:

1. Fetch tip tree (or at least manifest + this platform binary + NOTES) into local `{HAPI_HOME}/soup-artifacts/<tag>/` (or local artifacts root).
2. Point local `latest` (or the hub's offer tip pointer) → that tip so local offer construction picks it up.
3. Existing #247/#251 path: local hub offer moves → machine-policy `auto` runner keepalive-applies / push-upgrade. Do **not** reinvent self-upgrade RPC.

Layer A ownership ends at "seal bytes live under this hub's `soup-artifacts`." Runner apply stays hub-local. Layer B (hub PID itself) is the follow-on when required.

## Operator seal action (human / agent)

Spoken only: `fleet seal` | `good enough for fleet` | `seal tip <tag>`.

Mechanical (to implement):

1. Resolve tip (default: current dogfood `latest` tag, or named `<tag>`).
2. Verify tip `manifest.json` binaries are present and digests match files on disk.
3. Atomically retarget `fleet-latest` + write `fleet-latest-tag.txt`.
4. Optionally mirror that tip's assets to GH (same digests).
5. Estate: optional `POST /api/fleet/push-upgrade` for oos-registered `auto` machines (orthogonal; pets may already keepalive).
6. Upstream-destined product: open PR if that was part of the seal synonym.

## Explicit non-goals

- Enrolling ninja as an oos fleet machine.
- Watching dogfood `latest` for auto-apply on standalones.
- Tag/date/NOTES as sufficiency for upgrade.
- Agent SSH copy as the steady-state discover path.
- **Companion bash/node/cron watcher in a separate repo or alongside the hub process** (operator veto 2026-10-13).

## Implementation checklist

| Item | Status |
|------|--------|
| On-disk tip `manifest.json` + per-binary sha256 | **Exists** |
| Dogfood `latest` / `latest-tag.txt` | **Exists** |
| Seal `fleet-latest` / `fleet-latest-tag.txt` | **Exists** via `hapi-fleet-seal` |
| `hapi-fleet-seal` CLI | **Exists** (`scripts/tooling/hapi-fleet-seal.sh`) |
| GH release `manifest.json` asset | **Exists** on recent tips |
| GH "this release is the seal" pointer | **Missing** - optional v1.1 |
| Hub native `HAPI_UPSTREAM_SEAL_URL` poll + materialize (Layer A) | **In progress** - `hub/src/upgrade/upstreamSeal.ts` + startHub subscriber (#255); companion path dead |
| Hub process self-apply (Layer B) | **Missing** - follow-on; reuse runner swap primitives |
| Estate pets discover via oos hub offer | **Exists** (#247/#251) |

## Relay

Feasibility answered to `[Peer: fork main vs soup parity](/sessions/d2a67a01-07f9-4395-b84c-94d39c24e797)` and stop-ack to `[ninjcow-incus upkeep](/sessions/ba76163e-d993-4b2b-b4ab-c4cdf3c41c7e)` (2026-10-13). Build Layer A in-hub; do not stub a sidecar.
