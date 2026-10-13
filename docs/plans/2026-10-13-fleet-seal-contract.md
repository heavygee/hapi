# Fleet seal contract (standalone hub watcher)

**Status:** canon for implementers (ninja watcher + any future gift/personal hub).  
**Owner lane:** fleet / hub-runner-version governance (this session's remit).  
**Consumer:** `[ninjcow-incus upkeep](/sessions/ba76163e-d993-4b2b-b4ab-c4cdf3c41c7e)` and successors.  
**Related:** #247 deliberate push, #248 release notes, #251 per-machine auto keepalive, publish fix `44ef482d2` (stale binary).

## Product requirement (operator)

> I seal for the fleet → something is written to a known place → an **external** HAPI watching that place notices **new bytes** and updates itself.

Steady state is **not** agent SSH-and-copy. Estate pets on the oos hub already get offer + `auto` keepalive. Standalone hubs (ninja, gifts) need the same *discover* half against this contract.

## Two pointers (do not conflate)

| Pointer | Moves when | Watchers |
|---------|------------|----------|
| `latest` | Every successful soup single-exe **publish** (dogfood tip; remat thrash OK) | oos hub offer / estate dogfood only |
| `fleet-latest` | **Only** on operator **fleet seal** (`fleet seal` / `good enough for fleet` / `seal tip <tag>`) | Standalone hub watchers **must** poll this |

If `fleet-latest` is absent, there is **no seal** yet - watchers must not fall back to `latest` for auto-apply (that reintroduces tip thrash and the stale-tag class of lies). Human/agent bootstrap may still copy `latest` once by hand; that is not the contract.

**Tooling:** `hapi-fleet-seal [tag]` (scripts/tooling/hapi-fleet-seal.sh) points `fleet-latest` → tip and writes `fleet-latest-tag.txt` after verifying every `binaries[].sha256` matches on-disk files. Does **not** move dogfood `latest`. Spoken gate still required before agents run it.

## Poll locations (priority order)

### 1. Estate / tailnet (preferred when the watcher can reach oos)

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

How a remote watcher reaches that tree is transport (HTTP mirror, rclone, signed URL) - **out of band for v1**. Contract surface is the **files**, identical to local disk.

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

Interim for GH-only hosts (documented escape, not the happy path): operator names the sealed tag once; watcher then digests that release's `manifest.json` forever until the next named seal.

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

Watcher **must** parse `schema`, `tag`, and `binaries[]`. Unknown higher `schema` → fail closed (do not apply).

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

Kill-criterion (from the week of stale `755936f5…` under rotating tags): a watcher that upgrades when the **tag** changes but the **digest** does not is **non-compliant**.

## Apply sequence (standalone hub)

Once digest-new is proven:

1. Fetch tip tree (or at least manifest + this platform binary + NOTES) into local `{HAPI_HOME}/soup-artifacts/<tag>/`.
2. Point local `latest` → that tip (local hub offer source of truth).
3. Existing #247/#251 path: local hub offer moves → machine-policy `auto` runner keepalive-applies / push-upgrade. Watcher does **not** need to reinvent self-upgrade RPC if the local hub already does.

Watcher ownership ends at "seal bytes live under this hub's `soup-artifacts`." Hub+runner apply stays hub-local.

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

## Implementation checklist

| Item | Status |
|------|--------|
| On-disk tip `manifest.json` + per-binary sha256 | **Exists** |
| Dogfood `latest` / `latest-tag.txt` | **Exists** |
| Seal `fleet-latest` / `fleet-latest-tag.txt` | **Exists** via `hapi-fleet-seal` |
| `hapi-fleet-seal` CLI | **Exists** (`scripts/tooling/hapi-fleet-seal.sh`) |
| GH release `manifest.json` asset | **Exists** on recent tips |
| GH "this release is the seal" pointer | **Missing** - optional v1.1 |
| Ninja watcher vs this contract | **Pending** consumer (`ba76163e`) |
| Estate pets discover via oos hub offer | **Exists** (#247/#251) |

## Relay

When this doc lands: ping parity peer + ninjcow-incus with the path. Watcher may stub against `fleet-latest` once Meta/tooling creates the symlink; until then hold.
