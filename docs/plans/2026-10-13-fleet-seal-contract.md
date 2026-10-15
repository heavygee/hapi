# Fleet seal contract (operator fleet product)

> ## FORK-ONLY — permanent fleet product on `heavygee/hapi`
>
> This is the **operator's own fleet management system** — soup, seals, Layer A,
> pet install, cattle dispatch. People and instances rely on *him* over upstream.
> **Never** design, document, or frame any of this as upstream-bound to
> `tiann/hapi`. "IDK if it will ever go upstream" is the permanent operating
> assumption, not a temporary stance.
>
> @tiann rejected hub-artifact / auto-upgrade machinery on `tiann/hapi`
> (PR #1108, 2026-08-02). Closed door. Do not structure modules or PRs as
> "keep clean for a future upstream follow-up."

**Status:** canon for the **fork fleet** — estate pets on oos, standalone Layer A
(standalone personal hubs and successors), operator-controlled cattle (antevorta, soon `hapi-gc-in`),
and public one-liner pet installs.  
**Owner lane:** fleet / hub-runner-version governance.  
**Consumer:** `[nc-incus upkeep](/sessions/ba76163e-d993-4b2b-b4ab-c4cdf3c41c7e)` and successors - **in-product hub code only** (fork soup).  
**Issues:** [#255](https://github.com/heavygee/hapi/issues/255) Layer A ·
[#256](https://github.com/heavygee/hapi/issues/256) GH `hapi-fleet` ·
[#257](https://github.com/heavygee/hapi/issues/257) pet-install poles ·
[#258](https://github.com/heavygee/hapi/issues/258) seal dispatcher.  
**Related:** #247 #248 #251 · [#270](https://github.com/heavygee/hapi/issues/270) idle-gate ·
#1108 / #122 context.

## Product requirement (operator)

> I seal for the fleet → a durable public pointer moves → every subscribed
> instance converges on **new bytes**.

Steady state is **not** agent SSH-and-copy, and **not** a companion poller.
Native hub Layer A + spoken seal dispatch. Anyone installing from this fork
inherits the arrangement (#257). Target types are **generic** (registry), not
host-hardcoded — `hapi-gc-in` must slot in without redesign. Standalone personal
hubs need the same *discover* half as a **native hub capability**
(`HAPI_UPSTREAM_SEAL_URL` or settings-equivalent).

## Pull vs push (consent sits on the box)

Steady-state fleet upgrades are a **pull**, not a push. The box (hub Layer A
watcher, or keepalive against a local offer that already trailed a seal) watches
the sealed `fleet-latest` / GH `hapi-fleet` pointer and **decides to take it**.
Nothing reaches into a foreign machine and upgrades it unsolicited.

| Path | Who decides | Call it |
|------|-------------|---------|
| Layer A seal poll → materialize → #251 apply | Subscriber hub / machine | **pull** |
| Per-machine `auto` keepalive apply when local offer trails | That machine's hub | **pull** |
| `POST /api/fleet/push-upgrade` | Operator (or #258 dispatcher kicking **alert** hosts after a spoken seal) | **push** (deliberate only) |

Do **not** call the watcher / keepalive path "push-upgrade." That name is reserved
for the deliberate operator/API path. Words shape consent: "push" implied a
remote yank model this fleet does not have.

## Idle-gate on apply (#270)

Shared WORKING signal with soup patient drain: `session.thinking === true`.

**Mid-turn sessions defer the upgrade; idle sessions are terminated by the
restart.** Defer returns `upgrade_deferred` (no RPC). Idle / active-but-not-thinking
does not block. Under pull, terminating idle sessions is the machine's own choice
to take the seal - not a foundry yank of someone else's mid-turn work. Mid-turn
is still deferred. Sticky `thinking` is a probe bug to fix (#84), not a reason to
add an upgrade timeout.

## Three pointers (do not conflate)

| Pointer | Moves when | Consumers |
|---------|------------|-----------|
| Local + GH dogfood `latest` / dated tip as "Latest" release | Every soup **publish** (remat thrash OK) | oos hub dogfood only — **never** Layer A auto-apply |
| Local `fleet-latest` | Spoken **fleet seal** | Estate / on-network only |
| GH channel **`hapi-fleet`** | Same spoken **fleet seal** (mandatory mirror) | **Primary** for Layer A / off-estate / public pets |

If neither local `fleet-latest` nor GH `hapi-fleet` exists, there is **no seal**.
Never fall back to dogfood `latest` / `releases/latest`.

### Invariant: fleet is never ahead of dogfood

**Ordering that preserves it: publish, then seal the same tip.**

1. `hapi-soup-publish-single-exe` (or remat publish) moves dogfood `latest` → tip T.
2. Spoken `hapi-fleet-seal T` moves `fleet-latest` + GH `hapi-fleet` → tip T.

Sealing a tip dogfood has never pointed at makes Ninja the canary instead of this
box. If you must seal ahead of dogfood for a milestone, write the exception down
with date and reason — an undocumented inversion is how the invariant dies.

After every seal, report both: `fleet-latest = X, dogfood latest = Y`.

### The public URL is part of the seal, not a consequence

Followers poll `https://github.com/…/releases/download/hapi-fleet/manifest.json`,
not oos disk. A seal that flips local `fleet-latest` while the public CDN is
stale or 404 is a **failed seal** — it reports success-shaped local state while
followers see "nothing new" or a fetch error, with no alarm.

`hapi-fleet-seal` must: upsert GH channel assets, then **fetch the public URL**,
require HTTP 200, and compare **tag + every binary sha256** to the sealed tip.
Mismatch / non-200 → fail loudly; do not move local `fleet-latest` until public
verify passes. A check that cannot go red is not a check.

**Tooling:** `hapi-fleet-seal [tag]` verifies local tip digests, upserts GH
`hapi-fleet`, verifies the **public** manifest (tag+digests), **then** points
local `fleet-latest` (#256). Spoken gate required. Does **not** move dogfood
`latest`. Estate deliberate push (alert hosts) / cattle VM-swap are the #258
dispatcher, not this script alone. Layer A / `auto` hosts **pull** the new
pointer on their own.

## Poll locations

### 1. GitHub channel (primary for Layer A / pets off estate)

```text
https://github.com/heavygee/hapi/releases/download/hapi-fleet/manifest.json
```

Env: `HAPI_UPSTREAM_SEAL_URL` → that URL (pet install default after #257).  
Override channel name: `HAPI_FLEET_GH_CHANNEL_TAG` (default `hapi-fleet`).

Dated tip releases `hapi-soup-v*` remain immutable archives. The channel is a
**separate** mutable release: force-move tag + create-or-heal published release
(`--latest=false`) + `gh release upload --clobber`. Never delete-then-recreate
(async tag GC can orphan drafts → public asset 404s).

**Do not** poll `releases/latest` or pin forever on
`HAPI_UPSTREAM_SEAL_TAG=hapi-soup-v…` (proof-only / break-glass).

### 2. Estate / tailnet (oos-reachable only)

```text
{artifactsRoot}/fleet-latest/manifest.json   # + binaries
```

Root: `/var/lib/hapi/soup-artifacts/` (`HAPI_SOUP_ARTIFACTS_ROOT`). Same file
schema as GH.

### 3. Break-glass named tip

`HAPI_UPSTREAM_SEAL_TAG=hapi-soup-v…` → that release's `manifest.json` only.
Migrate to channel URL when available (standalone personal hub dogfood was TAG-pinned until #256).

## Manifest format (already live)

Published tip `manifest.json` (`schema: 1`) is the contract body. Subscriber
**must** parse `schema`, `tag`, and `binaries[]`. Unknown higher `schema` → fail
closed. Platform pick: match OS/arch (`linux-x64-baseline` for Linux x64 pets).

## Non-negotiable: digest-based change detection

**Newness = local installed (or staged) binary sha256 ≠ seal manifest entry sha256
for this platform.**

| Signal | Allowed as "new"? |
|--------|-------------------|
| Platform binary **sha256** differs from on-disk / running binary | **Yes** - only hard newness |
| `tag` / `composedTipSha` / `publishedAt` / NOTES changed | **No** alone |
| GitHub release created / date newer | **No** alone |
| `fleet-latest` / `hapi-fleet` retargeted but binary digest unchanged | **No** - refuse apply |

After download: re-hash bytes; must equal `binaries[].sha256` or abort.

## Target types (generic registry — #258)

| Class | Examples | Mechanism on spoken seal |
|-------|----------|--------------------------|
| `estate-pet` | machines registered on oos hub | local `fleet-latest` → offer trail → **#251 keepalive pull**; deliberate `POST /fleet/push-upgrade` only for alert hosts / explicit waves |
| `standalone-layer-a` | standalone personal hub CT, public pets | GH `hapi-fleet` → Layer A **self-discover pull** |
| `cattle-vm-swap` | antevorta, soon `hapi-gc-in` | VM-swap pipeline (disk reattach / new root / front door) — **not** binary in-place |

Registry lives in fork tooling (`scripts/tooling/fleet-targets.yaml` +
`hapi-fleet-seal-dispatch`). Adding a target = one YAML row, not a redesign.

## Feasibility shape (Layer A / B)

| Layer | What | Scope |
|-------|------|-------|
| **A - discover** | Hub polls `HAPI_UPSTREAM_SEAL_URL` → digest-compare → materialize tip into local `soup-artifacts/` → existing offer + #251 | Landed (#255). GH channel (#256) unblocks public/pet claim. |
| **B - hub process apply** | Swap hub's own binary + patient drain / systemd restart | Follow-on; reuse runner swap primitives. |

**What "I am SoT" means today:** offer URLs are relative `/cli/upgrade/cli-artifact?…` served by this hub; policy targets registered machines. Correct subscriber model: **materialize remote seal locally first**, then this hub remains SoT for *its* runners. Do not leave offer URLs pointed at oos while standalone personal hub runners download through a proxy forever.

**Kill-criteria:**

1. oos foundry must **not** set `HAPI_UPSTREAM_SEAL_URL` (ouroboros).
2. Never auto-apply off dogfood `latest` / GH `releases/latest`.
3. Shared single-exe path: ordered apply; no live-exec rewrite mid-flight.
4. Hub restart under live sessions = patient drain, not `pkill`.

## Apply sequence (standalone hub - Layer A)

1. Fetch tip into local `{HAPI_HOME}/soup-artifacts/<tag>/`.
2. Point local offer tip pointer → that tip.
3. Existing #247/#251 path: offer moves → machine-policy runner apply.

## Operator seal action

Spoken only: `fleet seal` | `good enough for fleet` | `seal tip <tag>`.

Mechanical:

1. Resolve tip (default: current dogfood `latest`, or named `<tag>`). Prefer a tip
   dogfood `latest` already points at (publish first if sealing current soup HEAD).
2. Verify tip digests on disk.
3. **Mandatory:** upsert GH `hapi-fleet` with same digests (#256).
4. **Mandatory:** fetch public channel URL; require HTTP 200; compare tag + digests
   to sealed tip. Fail closed if CDN stale/404 (public URL is part of the seal).
5. Only then retarget local `fleet-latest` + `fleet-latest-tag.txt`.
6. **Dispatch (#258):** estate deliberate push (alert) / Layer A (passive **pull**) / cattle VM-swap per registry.
7. Unrelated product commits already destined for `tiann/hapi` on their own merits
   may still get an upstream PR — that does **not** mean seal machinery goes upstream.

## Explicit non-goals

- Opening any of this on `tiann/hapi` — FORK-ONLY permanent.
- Enrolling a standalone personal hub as an oos fleet machine (they stay Layer A).
- Watching dogfood `latest` for auto-apply on standalones.
- Tag/date/NOTES as sufficiency for upgrade.
- Agent SSH copy or companion watcher as steady-state discover.
- Hardcoding only a couple of legacy hostnames (registry must accept `hapi-gc-in`).

## Implementation checklist

| Item | Status |
|------|--------|
| On-disk tip `manifest.json` + per-binary sha256 | **Exists** |
| Dogfood `latest` / `latest-tag.txt` | **Exists** |
| Seal `fleet-latest` / `fleet-latest-tag.txt` | **Exists** via `hapi-fleet-seal` |
| GH channel `hapi-fleet` upsert on every seal | **Exists** (`hapi-fleet-seal` + upsert; live channel bootstrapped) |
| Hub native Layer A poll + materialize | **#255** kernel on soup tip |
| Pet installer wires seal URL + 3-pole policy (default `auto`) | **Exists** (`install-hapi-pet.sh` #257; opt-out `--fleet-policy=alert|silent`) |
| Fleet-seal dispatcher (estate / Layer A / cattle) | **Exists** (`fleet-targets.yaml` + `hapi-fleet-seal-dispatch` #258) |
| Hub process self-apply (Layer B) | **Missing** - follow-on |
| Estate pets via oos hub offer | **Exists** (#247/#251) |

## Scope evolution (operator 2026-10-13)

1. **GitHub is the primary poll target** for Layer A — durable moving channel
   `hapi-fleet`; dated tips immutable; seal GH mirror mandatory.
2. **Public pet install inherits governance** — default URL + `auto` policy (#257;
   taking the fork fleet one-liner *is* the choice; `alert`/`silent` are explicit
   opt-outs).
3. **"Fleet seal" is a dispatch phrase** — estate / standalone / cattle (#258),
   generic target types including Ian's instances and soon `hapi-gc-in`.

Earlier "one-host-specific, Ian explicitly excluded" framing is **obsolete**. This
document is fleet-wide.

## Live dogfood (standalone personal hub CT, 2026-10-13) — proof ≠ steady state

First seal `hapi-soup-v2026.10.13-bc936f2` was consumed on nc-incus.
First consumption used GH named tag `HAPI_UPSTREAM_SEAL_TAG` (proof). Once
`hapi-fleet` exists, **migrate the standalone personal hub off the pin** onto
`HAPI_UPSTREAM_SEAL_URL=…/hapi-fleet/manifest.json` and clear the TAG env.

| Check | Result |
|-------|--------|
| Transport | GH named tag (CT has no SSH to oos); digest-new → materialize → #251 |
| ExecStart vs staged bin | Gotcha — fold into Layer B / install profile docs |
| Companion watcher | **Retired** — not steady state |

## Relay

Orchestration: `[Peer: fork main vs soup parity](/sessions/d2a67a01-07f9-4395-b84c-94d39c24e797)`.  
Standalone personal hub host: `[nc-incus upkeep](/sessions/ba76163e-d993-4b2b-b4ab-c4cdf3c41c7e)`. Companion freeze after live dogfood; Layer A owned in-product.

## Materialize all platforms (2026-10-15)

Layer A `materializeUpstreamSeal` **must stage every `manifest.binaries[]` entry**
(linux / darwin / windows), not only the hub host platform. Digest-newness still
compares the hub platform sha; the tip on disk is the full fleet artifact set so
Windows (and other) runners can pull upgrades from a standalone Layer A hub
without a second SoT.

Kill-criterion: after materialize, `fleet-latest/<every binaries[].path>` exists
and matches manifest sha256.
