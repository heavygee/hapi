# Fleet VM swap strategy — "operator says GO"

**Date:** 2026-09-04
**Owner:** operator (fleet-wide HAPI instance management)
**Parent context:** [`2026-09-03-soup-packaging-vm-rehearsal.md`](./2026-09-03-soup-packaging-vm-rehearsal.md) (VM 2097 proof, "snapshot not recipe" verdict), `docs/tooling/driver-soup.md`

**Goal:** operator picks a fleet shard (a group of users on a shared HAPI instance) and an artifact version, says "go," and a new VM carrying the latest HAPI state gets attached in place of the old one. Users notice nothing except new features after a normal page reload — no re-login, no lost sessions, no manual re-pointing.

---

## 1. Hard constraints (non-negotiable, discovered before designing around them)

| Constraint | Why it matters | Consequence for the design |
|---|---|---|
| `hapi.db` is **SQLite**, single-writer | Two VMs cannot both have it open read-write at once — that's corruption, not a swap | The swap must be a **handoff** (old fully stops writing before new starts), never a simultaneous dual-active |
| `HAPI_HOME` already controls where `settings.json` (→ `cliApiToken`) and `hapi.db` live (`hub/src/configuration.ts:177-189`) — **no code change needed** | If `HAPI_HOME` stays default (`~/.hapi` on local VM disk), every swap regenerates a new token and users get logged out | Deploy with `HAPI_HOME` pointed at a **persistent volume**, mounted fresh on whichever VM is currently active |
| `/health` reports `protocolVersion` (currently `1`) | This is the actual client/server compatibility contract, not the git SHA | A swap is only safe to do **silently** when `protocolVersion` is unchanged. A `protocolVersion` bump is a breaking change and needs a real release note, not a silent cutover |
| Cold clone + `hapi-driver-rebuild` is **non-deterministic** (proven in the 2026-09-03 rehearsal — fails on layer 1/48, misses 6 unpublished branches, tip-forward diverges even from a good starting tip) | You cannot "rebuild fresh on each target VM" and expect fleet-wide consistency | The distributable unit must be a **frozen, versioned artifact** (bundle/mirror of a composed tip + built `web/dist`), built once, shipped everywhere unchanged |

---

## 2. Pipeline

| Stage | What happens | Mechanism (reuses existing tooling where possible) | Verification gate | User-visible effect |
|---|---|---|---|---|
| **0. Build golden artifact** (once per release, not per-VM) | Freeze a known-good `driver/integration` tip + built `web/dist` into one versioned, immutable bundle | `git bundle`/mirror export, per rehearsal §5 recommendation | Boot a scratch VM from it, confirm `/health` 200 + `/` serves real UI (done manually for VM 2097 on 2026-09-03/04) | None |
| **1. Externalize state** ✅ already supported, zero code change | `HAPI_HOME=/mnt/hapi-data` (persistent volume) instead of default `~/.hapi` | Existing env var (`hub/src/configuration.ts:177`) | Fresh VM booted against the volume comes up with the *same* token + sessions, no regeneration | Precondition for everything below |
| **2. Stable front door per shard** — **not built yet** | Users' Tailscale hostname (e.g. `hapi-acme.tail9944ee.ts.net`) never changes; it's a thin reverse-proxy node whose backend target is a one-line config flip | Small proxy (Caddy/nginx) or `tailscale serve`, backend = `{current_vm_ip}:3006` in one file | Proxy health-checks its backend before forwarding | This is what makes the swap invisible — clients never re-point |
| **3. Versioning strategy** — **open, needs sign-off** | See §3 below for the proposal | — | — | — |
| **4. Operator says GO** | Pick shard(s) + artifact version | Orchestrator wrapping existing `qm clone` / `dryrun-oos-soup-rehearsal-vm.sh`-style provisioning | Dry-run mode first (pattern already used by `hapi-resurrect-session --dry-run`) | Nothing yet |
| **5. Boot new VM dark** | Mounts the *same* data volume **read-only** or a point-in-time snapshot first | Same artifact from stage 0 | `/health` 200, `/` 200, `protocolVersion` matches expected | Nothing |
| **6. Patient-drain the old writer** | Stop new sessions on OLD VM, let in-flight turns finish, release the DB file lock | **Reuse `hapi-restart-hub`'s existing patient drain** (10 min timeout) — do not reinvent | Drain completes, lock released | Brief pause only for users mid-turn at that instant — same as today's restarts |
| **7. Cutover** | Volume attaches read-write to new VM, new hub becomes sole writer, front door flips backend pointer | One atomic config write on the proxy node | New VM confirms write lock; front door confirms new backend healthy before flipping | User reloads → new hub, same URL, same login, same sessions, new features |
| **8. Decommission old VM** | Park or destroy | `qm destroy` (or park, per existing convention: "destroyed after write-up, or kept only if operator asks") | Confirm nothing still points at it | None |
| **9. Rollback** | If any gate in stage 5/7 fails, front door never flips | No mutation past stage 5 until the gate passes | — | None — old VM was never touched |

---

## 3. Versioning strategy (proposal — needs operator sign-off)

Tag each golden artifact as:

```
hapi-soup-v<YYYY.MM.DD>-<7-char-composed-tip-SHA>
```

e.g. `hapi-soup-v2026.09.04-46f3330`

Each tag's manifest records:

- composed tip SHA + tree OID (what the 2026-09-03 rehearsal already captures as "evidence crumbs")
- manifest layer count (drift indicator vs `origin/main`)
- `web/dist` build hash
- `protocolVersion` at build time

**Compatibility rule:** a swap is silent-safe only when `protocolVersion` is unchanged from the currently-deployed artifact. If `protocolVersion` bumps, treat it as a real release (announce it), not a background swap — this is the actual definition of "seamless" the operator asked for; it isn't "always silent," it's "silent when nothing broke."

This is a proposal, not a decision — flagging for operator confirmation before it's load-bearing.

---

## 4. Dry run — Antevorta

Before building the orchestrator (stage 4+), prove stages 0–1 end to end on real (non-throwaway) hardware: the Antevorta machine (`in-linux`, VMID 100, Debian 12, 192.168.4.20, GPUs passed through, **no HAPI installed yet** as of 2026-09-04 per the Antevorta-setup peer session).

Ask: install HAPI on `in-linux` with `HAPI_HOME` pointed at a dedicated persistent volume/mount (not the VM's root disk) from the start, and document the exact mount + env var setup so it's reproducible for the next shard. See ping sent to `75e1613f-cba6-4ed4-a16c-8904e6629df2` ("Antevorta setup") on 2026-09-04.

---

## 5. Status

- [x] Stage 1 confirmed already supported by existing code — no build work needed, just correct ops usage
- [ ] Stage 2 (stable front-door proxy) — not built
- [ ] Stage 3 (versioning) — proposed above, awaiting operator sign-off
- [ ] Stages 4-9 (orchestrator) — not built
- [ ] Antevorta dry run — requested, pending
