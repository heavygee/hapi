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
| **Confirmed 2026-09-11 (Antevorta, operator sign-off):** "persistent state" is not just `HAPI_HOME` — it also includes every agent's working directories (checkouts, worktrees, session transcripts). Operator's reasoning: the HAPI *binary/version* is the only genuinely ephemeral thing here; the DB and the agent working material are both "the state," and a swap that preserves one but not the other isn't a no-op for the user | A swap that remounts `HAPI_HOME` but leaves agent worktrees on the old VM's throwaway root disk loses in-progress work, which is exactly the failure mode Stage 1 exists to prevent | **Isolation goal (2026-09-11):** one Proxmox data disk attached to the VM, guest split into two quota'd filesystems for `HAPI_HOME` vs agent worktrees — same benefit as oos-linux's scsi2/scsi4 split (runaway `work` can't starve the DB). **Mechanism is target-specific:** oos-linux uses host-level disk separation; antevorta/in-linux (2026-09-11 bring-up) uses **LVM** on a single 150G data disk (not ZFS — Debian 12 stock repos + DKMS/contrib risk on cloud-image kernels). ZFS datasets remain a valid option where `zfsutils-linux` is acceptable. Stage 7 cutover is still **one** `qm` disk reattach per swap regardless of guest filesystem. Canon runbook: `lockhouse/producer/docs/hapi-vm-bringup.md` |
| ~~No active "stop accepting new work" primitive exists in HAPI today~~ — **resolved 2026-09-11 (Gavin sign-off):** checked `scripts/tooling/lib/patient-drain.sh` (what `hapi-restart-hub` already uses) — it only polls the WORKING-session count and waits for zero (with timeout), no active new-session block. **Confirmed this is fine as-is, not a gap:** it's the same bar already applied to every soup restart today, not a lesser one for antevorta specifically. No new code needed | — | Quiesce for the VM swap reuses `hapi-restart-hub`'s existing patient drain unchanged. Closed. |
| `/health` reports `protocolVersion` (currently `1`) | This is the actual client/server compatibility contract, not the git SHA | A swap is only safe to do **silently** when `protocolVersion` is unchanged. A `protocolVersion` bump is a breaking change and needs a real release note, not a silent cutover |
| Cold clone + `hapi-driver-rebuild` is **non-deterministic** (proven in the 2026-09-03 rehearsal — fails on layer 1/48, misses 6 unpublished branches, tip-forward diverges even from a good starting tip) | You cannot "rebuild fresh on each target VM" and expect fleet-wide consistency | The distributable unit must be a **frozen, versioned artifact** (bundle/mirror of a composed tip + built `web/dist`), built once, shipped everywhere unchanged |
| **Confirmed 2026-09-09 on VM 2097's real soup replant:** even the *correct* frozen tip fails `bun run build` on a virgin guest (same `mdast` resolution class as the rehearsal — oos only succeeds because mirror `node_modules` leaks into driver resolve) | "Ship the git bundle" alone is not sufficient — a virgin target cannot build its own `web/dist` | The distributable artifact **must** include a pre-built `web/dist` from the source machine (upgraded here from "preferred" to **required**), plus whatever hub-side dependency hoists let it start |
| **Confirmed 2026-09-09:** an old (`main`-schema) `hapi.db` doesn't have soup-only tables (e.g. `session_jobs`) — the soup hub refuses to start against it | A swap onto a machine with an existing, differently-versioned DB is not just a single-writer problem, it's a **schema compatibility** problem | Stage 6 (patient drain / cutover) needs a schema-check step before attaching an existing data volume to a new artifact version; falling back to a fresh DB loses sessions, which is real, visible data loss the operator must consciously accept, not something automated silently |

---

## 2. Pipeline

| Stage | What happens | Mechanism (reuses existing tooling where possible) | Verification gate | User-visible effect |
|---|---|---|---|---|
| **0. Build golden artifact** (once per release, not per-VM) | **Revised 2026-09-09 — better mechanism found.** The repo already has `bun build:single-exe[:all]` (root `package.json`): `build:web` → `hub/generate:embedded-web-assets` → `cli/build:exe:allinone`. This produces **one self-contained binary per platform** with the web UI **embedded in the exe** (not a side-car file), and that binary IS `hapi` (CLI) / `hapi hub` / `hapi runner start` — all three components, zero build step needed on the target. Strictly better than git-bundle-plant + shipping `web/dist` separately (what 2097 needed) | **Done 2026-09-11 (meta-bot):** `hapi-driver-rebuild --build-web --verify` on oos now auto-runs `bun build:single-exe:all` + publish after verify (skip via `HAPI_SKIP_SOUP_SINGLE_EXE=1`); manual one-off via `hapi-soup-publish-single-exe` (or `--dry-run`). Publishes to `/var/lib/hapi/soup-artifacts/hapi-soup-v<YYYY.MM.DD>-<7-char-tip>/` + `latest` symlink + `manifest.json`, mirrored to `/var/lib/hapi/upgrade-artifacts/` for the Linux x64 baseline. Details: `docs/tooling/driver-soup.md` § Soup single-exe fleet artifacts. oos is the only environment where the underlying `build:web` reliably succeeds (mirror `node_modules` leak, see hard-constraints table) — build there, never on the target | Boot a scratch VM/host, run the downloaded binary directly, confirm `/health` 200 + `/` serves real UI (manual bundle-plant version of this done for VM 2097 on 2026-09-03/04/09) | None |
| **1. Externalize state** ✅ proven on antevorta 2026-09-11 | One Proxmox data disk on the VM, guest split into two quota'd mountpoints: `HAPI_HOME` volume and agent `work` volume (LVM on antevorta; ZFS or host-level multi-disk also valid — see hard-constraints row) | Existing env var (`hub/src/configuration.ts:177`) for `HAPI_HOME`; agent checkouts on the separate `work` mount, no HAPI code involved | Fresh VM booted against the volume comes up with the *same* token + sessions + in-progress agent checkouts, no regeneration, no re-clone; a runaway `work` tree can't starve `HAPI_HOME` of space | Precondition for everything below |
| **2. Stable front door per shard** — **not built yet** | Users' Tailscale hostname (e.g. `hapi-acme.tail9944ee.ts.net`) never changes; it's a thin reverse-proxy node whose backend target is a one-line config flip | Small proxy (Caddy/nginx) or `tailscale serve`, backend = `{current_vm_ip}:3006` in one file | Proxy health-checks its backend before forwarding | This is what makes the swap invisible — clients never re-point |
| **3. Versioning strategy** — **open, needs sign-off** | See §3 below for the proposal | — | — | — |
| **4. Operator says GO** | Pick shard(s) + artifact version | Orchestrator wrapping existing `qm clone` / `dryrun-oos-soup-rehearsal-vm.sh`-style provisioning | Dry-run mode first (pattern already used by `hapi-resurrect-session --dry-run`) | Nothing yet |
| **5. Boot new VM's root disk** | New VM comes up with the new HAPI binary on its **own root disk** — does not touch the shared volume yet, so this can happen while the old VM is still live and serving | `qm clone`/provision from the cattle recipe, new binary from stage 0 | `/health` 200 on the new binary against a scratch/no `HAPI_HOME`, confirming the binary itself boots | None — old VM still fully serving |
| **6. Patient-drain the old writer, then stop it** | Stop new sessions on OLD VM, let in-flight turns finish, then `qm stop` the old VM entirely (not just the process) so it releases the shared volume | **Reuse `hapi-restart-hub`'s existing patient drain** (10 min timeout, polls WORKING count) — "stop new sessions" is an operator-announced convention today, not an enforced gate (see hard-constraints table) | WORKING count hits zero, `qm stop` confirms the guest is down | Brief pause only for users mid-turn at that instant — anything actively executing gets interrupted; mitigation relies on Claude Code sessions' existing resume-from-transcript behavior, same as surviving any other reconnect, not a new mechanism |
| **7. Cutover** | Detach the shared data disk from the old VM's config, attach it to the new VM's config, start the new VM — **no copy involved**, same disk just re-pointed; guest mounts both volumes (LVM VG import or ZFS pool import, depending on target) | **One** `qm set <old> --delete <disk>` / `qm set <new> --scsiN <volume>`, then `qm start <new>`; front door (`svc:` VIP) flips its backend pointer as the last step | New VM boots against the same `HAPI_HOME` + working dirs, confirms `/health` 200 + write lock; front door confirms new backend healthy before flipping | User reloads → new hub, same URL (VIP never changed), same login, same sessions, same in-progress agent checkouts, new features |
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

- **oos-linux precedent is two disks at the Proxmox layer** (`scsi0` root 128G/63G used, `scsi2` "hapi-hot" 96G/30G used at `/var/lib/hapi`, and agent working directories on a separate `scsi4` `vm-2002-disk-work`).
- **Antevorta/in-linux (2026-09-11 bring-up):** one 150G Proxmox data disk, guest **LVM** split into `HAPI_HOME` vs `work` volumes (same isolation goal, different mechanism than ZFS — see hard-constraints row). Runbook: `lockhouse/producer/docs/hapi-vm-bringup.md`.
- **Antevorta has no capacity concern.** Host storage: `nvme4` 3.53T, `nvme2` 1.81T, `hdd8` 8TB (per `lockhouse-janus` LOGBOOK, 2026-09-02). A full agent checkout with `node_modules` ballparks 1.5–2.5G — even dozens of concurrent agent worktrees for three users stays in the tens-of-GB range.

## 4. First bring-up — Antevorta (done 2026-09-11)

**Stage 0–1 complete** on `in-linux` (VMID 100, Debian 12, 192.168.4.20):

| Item | Status |
|------|--------|
| Data disk | 150G, LVM split (`HAPI_HOME` + `work`) |
| HAPI install | single-exe `hapi-soup-v2026.09.11-9622798`, hub + runner under `hapi` user |
| Front door | `https://hapi-antevorta.forest-adder.ts.net` (Tailscale `svc:hapi-antevorta`) |
| Users | Doug logged in (`claude auth` oauth, runner wired) |
| oos hub fleet list | **Not expected** — antevorta is a **separate shard/instance**, not a runner on oos-linux |

**Second bring-up (2026-09-11):** janus `in-svc-01` — same pattern, staged/stopped, prep for future in-scope migration.

**Next test:** VM **swap** mechanism (stages 4–9) — new VM, same persistent volume, no data loss — not initial bring-up.

---

## 5. Status

- [x] Stage 0 golden artifact — `hapi-soup-v2026.09.11-9622798` published; antevorta installed from it
- [x] Stage 1 externalize state — proven on antevorta/in-linux (150G LVM data disk, `HAPI_HOME` + `work` split)
- [x] Stage 2 front door (antevorta shard) — `svc:hapi-antevorta` live at `https://hapi-antevorta.forest-adder.ts.net`
- [ ] Stage 2 (generic per-shard proxy pattern) — not automated/scripted beyond antevorta manual bring-up
- [ ] Stage 3 (versioning) — proposed above, awaiting operator sign-off
- [ ] Stages 4-9 (orchestrator + VM swap) — design confirmed 2026-09-11; **next real test** is swap cutover (not bring-up)
- [x] Antevorta first install — complete 2026-09-11 (hub + runner healthy, Doug logged in). Runbook: `lockhouse/producer/docs/hapi-vm-bringup.md`
- [ ] Antevorta VM swap rehearsal — not started (stages 6–7: patient drain + disk reattach to new VM root)
- [x] Quiesce resolved 2026-09-11 (Gavin sign-off): reuse `hapi-restart-hub`'s existing patient drain unchanged
- [x] Stage 0 automation (2026-09-11): `hapi-driver-rebuild --build-web --verify` on oos publishes soup single-exe artifacts
