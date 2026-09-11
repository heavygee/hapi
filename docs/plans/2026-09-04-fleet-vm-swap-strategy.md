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
| **Confirmed 2026-09-11 (Antevorta, operator sign-off):** "persistent state" is not just `HAPI_HOME` — it also includes every agent's working directories (checkouts, worktrees, session transcripts). Operator's reasoning: the HAPI *binary/version* is the only genuinely ephemeral thing here; the DB and the agent working material are both "the state," and a swap that preserves one but not the other isn't a no-op for the user | A swap that remounts `HAPI_HOME` but leaves agent worktrees on the old VM's throwaway root disk loses in-progress work, which is exactly the failure mode Stage 1 exists to prevent | The persistent volume is **one shared volume**, not two: it holds `HAPI_HOME` *and* all agent working directories. VM root disk = OS + current HAPI binary only, nothing else, fully throwaway |
| No active "stop accepting new work" primitive exists in HAPI today — checked 2026-09-11. `hapi-restart-hub`'s patient drain (`scripts/tooling/lib/patient-drain.sh`) only **polls** the WORKING-session count and waits for it to hit zero (with timeout); it does not block new session starts during the wait, and does not signal in-flight agents to wrap up early | A volume-detach swap needs the old VM to genuinely stop mutating the volume before detach, or the swap risks a session starting mid-quiesce and getting orphaned when the volume moves | For the first swap, treat "stop new work" as an **operator-enforced convention** (announce the window to the three known users), not enforced code — see §6 open items for what an enforced gate would need if usage grows past a handful of known people |
| `/health` reports `protocolVersion` (currently `1`) | This is the actual client/server compatibility contract, not the git SHA | A swap is only safe to do **silently** when `protocolVersion` is unchanged. A `protocolVersion` bump is a breaking change and needs a real release note, not a silent cutover |
| Cold clone + `hapi-driver-rebuild` is **non-deterministic** (proven in the 2026-09-03 rehearsal — fails on layer 1/48, misses 6 unpublished branches, tip-forward diverges even from a good starting tip) | You cannot "rebuild fresh on each target VM" and expect fleet-wide consistency | The distributable unit must be a **frozen, versioned artifact** (bundle/mirror of a composed tip + built `web/dist`), built once, shipped everywhere unchanged |
| **Confirmed 2026-09-09 on VM 2097's real soup replant:** even the *correct* frozen tip fails `bun run build` on a virgin guest (same `mdast` resolution class as the rehearsal — oos only succeeds because mirror `node_modules` leaks into driver resolve) | "Ship the git bundle" alone is not sufficient — a virgin target cannot build its own `web/dist` | The distributable artifact **must** include a pre-built `web/dist` from the source machine (upgraded here from "preferred" to **required**), plus whatever hub-side dependency hoists let it start |
| **Confirmed 2026-09-09:** an old (`main`-schema) `hapi.db` doesn't have soup-only tables (e.g. `session_jobs`) — the soup hub refuses to start against it | A swap onto a machine with an existing, differently-versioned DB is not just a single-writer problem, it's a **schema compatibility** problem | Stage 6 (patient drain / cutover) needs a schema-check step before attaching an existing data volume to a new artifact version; falling back to a fresh DB loses sessions, which is real, visible data loss the operator must consciously accept, not something automated silently |

---

## 2. Pipeline

| Stage | What happens | Mechanism (reuses existing tooling where possible) | Verification gate | User-visible effect |
|---|---|---|---|---|
| **0. Build golden artifact** (once per release, not per-VM) | **Revised 2026-09-09 — better mechanism found.** The repo already has `bun build:single-exe[:all]` (root `package.json`): `build:web` → `hub/generate:embedded-web-assets` → `cli/build:exe:allinone`. This produces **one self-contained binary per platform** with the web UI **embedded in the exe** (not a side-car file), and that binary IS `hapi` (CLI) / `hapi hub` / `hapi runner start` — all three components, zero build step needed on the target. Strictly better than git-bundle-plant + shipping `web/dist` separately (what 2097 needed) | Run `bun build:single-exe:all` on oos as part of the `hapi-driver-rebuild --build-web --verify` promote step (owned by "cursor - tooling/meta bot") — oos is the only environment where the underlying `build:web` reliably succeeds (mirror `node_modules` leak, see hard-constraints table), so build there, publish the resulting binaries, never build on the target. Tag per §3's versioning scheme. Proposed to the meta-bot 2026-09-09, awaiting response | Boot a scratch VM/host, run the downloaded binary directly, confirm `/health` 200 + `/` serves real UI (manual bundle-plant version of this done for VM 2097 on 2026-09-03/04/09) | None |
| **1. Externalize state** ✅ already supported for `HAPI_HOME`, design confirmed for the rest | `HAPI_HOME=/mnt/hapi-data/hapi-home` **plus** all agent working directories (checkouts, worktrees, session transcripts) also rooted under the same mounted volume, e.g. `/mnt/hapi-data/coding` — one shared second disk, not two separate ones | Existing env var (`hub/src/configuration.ts:177`) for `HAPI_HOME`; the working-dir half is just "put the coding tree there instead of on VM root," no HAPI code involved | Fresh VM booted against the volume comes up with the *same* token + sessions + in-progress agent checkouts, no regeneration, no re-clone | Precondition for everything below |
| **2. Stable front door per shard** — **not built yet** | Users' Tailscale hostname (e.g. `hapi-acme.tail9944ee.ts.net`) never changes; it's a thin reverse-proxy node whose backend target is a one-line config flip | Small proxy (Caddy/nginx) or `tailscale serve`, backend = `{current_vm_ip}:3006` in one file | Proxy health-checks its backend before forwarding | This is what makes the swap invisible — clients never re-point |
| **3. Versioning strategy** — **open, needs sign-off** | See §3 below for the proposal | — | — | — |
| **4. Operator says GO** | Pick shard(s) + artifact version | Orchestrator wrapping existing `qm clone` / `dryrun-oos-soup-rehearsal-vm.sh`-style provisioning | Dry-run mode first (pattern already used by `hapi-resurrect-session --dry-run`) | Nothing yet |
| **5. Boot new VM's root disk** | New VM comes up with the new HAPI binary on its **own root disk** — does not touch the shared volume yet, so this can happen while the old VM is still live and serving | `qm clone`/provision from the cattle recipe, new binary from stage 0 | `/health` 200 on the new binary against a scratch/no `HAPI_HOME`, confirming the binary itself boots | None — old VM still fully serving |
| **6. Patient-drain the old writer, then stop it** | Stop new sessions on OLD VM, let in-flight turns finish, then `qm stop` the old VM entirely (not just the process) so it releases the shared volume | **Reuse `hapi-restart-hub`'s existing patient drain** (10 min timeout, polls WORKING count) — "stop new sessions" is an operator-announced convention today, not an enforced gate (see hard-constraints table) | WORKING count hits zero, `qm stop` confirms the guest is down | Brief pause only for users mid-turn at that instant — anything actively executing gets interrupted; mitigation relies on Claude Code sessions' existing resume-from-transcript behavior, same as surviving any other reconnect, not a new mechanism |
| **7. Cutover** | Detach the shared volume from the old VM's config, attach it to the new VM's config, start the new VM — **no copy involved**, same disk just re-pointed | `qm set <old> --delete <disk>` / `qm set <new> --scsiN <volume>` (Proxmox disk reassignment), then `qm start <new>`; front door (`svc:` VIP) flips its backend pointer as the last step | New VM boots against the same `HAPI_HOME` + working dirs, confirms `/health` 200 + write lock; front door confirms new backend healthy before flipping | User reloads → new hub, same URL (VIP never changed), same login, same sessions, same in-progress agent checkouts, new features |
| **8. Decommission old VM** | Park or destroy the (now diskless-of-state) old VM | `qm destroy` (or park, per existing convention: "destroyed after write-up, or kept only if operator asks") | Confirm nothing still points at it | None |
| **9. Rollback** | If any gate in stage 5/7 fails, the volume never detaches and the front door never flips | No mutation past stage 5 until the gate passes | — | None — old VM was never stopped until stage 6's gate passed |

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

## 3a. Sizing — checked against oos-linux precedent and antevorta's real capacity (2026-09-11)

- **oos-linux precedent is actually two disks bundled as a pair, not one volume:** `scsi0` root is 128G (63G used), `scsi2` "hapi-hot" (`/var/lib/hapi` — DB, backups, ACP session drawers) is 96G (30G used, 33%), and agent working directories (git checkouts/worktrees/`node_modules`) live on a *third*, separate disk (`scsi4`, `vm-2002-disk-work`, mounted at `~/coding`) — not on hapi-hot. So the existing production pattern is "root disk is throwaway, two other disks travel together," not literally one merged volume. Worth confirming with Gavin whether "one shared volume" (§ hard constraints) means literally one block device, or just "these travel together as an atomic pair on every swap" — the latter is what's actually proven at oos-linux scale and Proxmox disk reassignment (stage 7) works the same either way (one `qm set` per disk instead of one).
- **Antevorta has no capacity concern.** Host storage: `nvme4` 3.53T, `nvme2` 1.81T, `hdd8` 8TB (per `lockhouse-janus` LOGBOOK, 2026-09-02). A full agent checkout with `node_modules` ballparks 1.5–2.5G (`du -sh` on this repo's own `driver` and worktree checkouts) — even dozens of concurrent agent worktrees for three users (Gavin, Doug, Ian) stays in the tens-of-GB range, trivial against a 3.53T pool.
- **The real gap is provisioning, not capacity:** VM 100's only disk today is the 32GB throwaway root on `nvme4` (`lockhouse-janus/config/antevorta-in-linux.env.example`) — the second/data disk `docs/practice-antevorta.md` calls for doesn't exist yet. This has to be created (size doesn't matter much given the headroom above — 100–200G would be generous) before the first HAPI install on `in-linux`, not after.

## 4. Dry run — Antevorta

Before building the orchestrator (stage 4+), prove stages 0–1 end to end on real (non-throwaway) hardware: the Antevorta machine (`in-linux`, VMID 100, Debian 12, 192.168.4.20, GPUs passed through, **no HAPI installed yet** as of 2026-09-04 per the Antevorta-setup peer session).

Ask: install HAPI on `in-linux` with `HAPI_HOME` pointed at a dedicated persistent volume/mount (not the VM's root disk) from the start, and document the exact mount + env var setup so it's reproducible for the next shard. See ping sent to `75e1613f-cba6-4ed4-a16c-8904e6629df2` ("Antevorta setup") on 2026-09-04.

---

## 5. Status

- [x] Stage 1 confirmed already supported by existing code for `HAPI_HOME`; scope extended 2026-09-11 to also cover agent working directories on the same (or paired) volume — no build work needed, just correct ops usage and provisioning the second disk on `in-linux`
- [ ] Stage 2 (stable front-door proxy, the `svc:` VIP reachable by Gavin + Doug/Ian) — not built
- [ ] Stage 3 (versioning) — proposed above, awaiting operator sign-off
- [ ] Stages 4-9 (orchestrator) — design confirmed 2026-09-11 (concrete `qm`-based attach/detach procedure, §2), not yet built/scripted
- [ ] Antevorta dry run — host is back online (postmortem merged, AppArmor/dhclient root cause, unrelated to HAPI); VM 100 currently stopped, no HAPI ever installed on it. Second disk for the shared volume needs provisioning before install.
- [ ] Open: confirm with Gavin whether the shared volume is literally one disk or an atomic pair (see §3a) — doesn't block starting, just affects the `qm` commands in stage 7
- [ ] Open: quiesce enforcement is a social convention for the first swap (patient-drain only polls/waits, doesn't block new session starts) — fine for 3 known users, revisit if usage grows
- [x] Stage 0 automation (2026-09-11): `hapi-driver-rebuild --build-web --verify` on oos publishes to `/var/lib/hapi/soup-artifacts/<tag>/` via `scripts/tooling/lib/driver-soup-single-exe-publish.sh`; manual: `hapi-soup-publish-single-exe`. First full publish still pending next verified remat (or run manual now for Antevorta).
