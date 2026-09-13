# Fleet VM swap strategy — "operator says GO"

**Date:** 2026-09-04
**Owner:** operator (fleet-wide HAPI instance management)
**Parent context:** [`2026-09-03-soup-packaging-vm-rehearsal.md`](./2026-09-03-soup-packaging-vm-rehearsal.md) (VM 2097 proof, "snapshot not recipe" verdict), `docs/tooling/driver-soup.md`

**Goal:** operator picks a fleet shard (a group of users on a shared HAPI instance) and an artifact version, says "go," and a new VM carrying the latest HAPI state gets attached in place of the old one. Users notice nothing except new features after a normal page reload — no re-login, no lost sessions, no manual re-pointing.

**Progress vs. this goal, stated plainly (2026-09-13): the goal above is unproven and largely unbuilt.** Every "PASS" recorded in §4 is an **in-place binary upgrade on a single, unchanged VM** — same machine, same IP, no VM ever created or destroyed, front door never touched because it never needed to move. That proves Stage 1 (externalized state survives a version bump) and validates the separate "pet" self-upgrade design in §6. It proves **nothing** about the actual goal stated above: no new VM has ever been booted as part of a swap, no disk has ever been reattached across VMs, no front door has ever been repointed, and Stage 2's generic per-shard proxy pattern doesn't exist beyond one hand-built instance. Read every "PASS" below with that scope, not as progress toward seamless VM swap-out.

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

**In-place upgrade test — PASS (2026-09-13):** `hapi-soup-v2026.09.11-9622798` → `hapi-soup-v2026.09.13-cd7d515` (54→58 layers), binary swap + stop/start (no `hapi-restart-hub` on this VM yet — fresh install, not on the oos fleet-machine list). Before/after: `/health` unchanged (`protocolVersion: 1`), `cliApiToken` byte-identical, Doug's `oauth_token` login survived with **no re-auth prompt**, session/message/machine counts unchanged (0/0/1 — this VM has zero real usage yet), binary sha256 matches each tag's manifest, new PIDs confirmed (genuine restart, not stale process). Old binary kept at `/opt/hapi/hapi.bak-9622798` for rollback.

**Confirms:** Stage 1 (externalized state via `HAPI_HOME=/var/lib/hapi`) holds under a real version bump — the core "swap doesn't lose state" claim, proven on real hardware, not just in the design doc.

**Does not yet confirm:** drain-under-load. Zero sessions were `WORKING` at swap time, so this was a clean stop→swap→start, not a real patient-drain scenario. Next real gap: repeat with active sessions in flight to prove the drain path (not just the state-externalization path).

**Second host, same result — janus `in-svc-01` (2026-09-13):** the VM already had the identical HAPI service-layer setup from its 09-11 staged bring-up (LVM `hapi-hot`+`work` split, single-exe artifact, `svc:hapi-janus` front door) — just stopped, not entangled with the blocked official IN-zone network rebuild (bridges/CIDR — a separate host-network process, never touched). Started it, ran the identical `9622798` → `cd7d515` in-place upgrade: `/health` unchanged, `cliApiToken` byte-identical, session/message/machine counts unchanged (0/0/1), binary sha256 matched each tag's manifest, new PIDs confirmed. **Two-for-two: the design holds across two independent physical hosts, not just one.** Same caveat as antevorta — zero real sessions on this box either, drain-under-load still unproven on both. Stopped again afterward per operator's "not 24/7 yet" instruction for this box.

**Next test:** full VM **swap** mechanism (stages 4–9) — new VM, same persistent volume reattached, no data loss — distinct from both the in-place upgrade just proven (twice) and the initial bring-up.

---

## 5. Status

**Reminder:** every `[x]` below marked "in-place upgrade" or "PASS" is Stage 1 / pet-path validation only — same VM, no swap. Stages 2 (generic), 3, and 4-9 (the actual VM-swap mechanism this doc's Goal describes) remain not started, full stop.

- [x] Stage 0 golden artifact — `hapi-soup-v2026.09.11-9622798` published; antevorta installed from it
- [x] Stage 1 externalize state — proven on antevorta/in-linux (150G LVM data disk, `HAPI_HOME` + `work` split)
- [x] Stage 2 front door (antevorta shard) — `svc:hapi-antevorta` live at `https://hapi-antevorta.forest-adder.ts.net`
- [ ] Stage 2 (generic per-shard proxy pattern) — not automated/scripted beyond antevorta manual bring-up
- [ ] Stage 3 (versioning) — proposed above, awaiting operator sign-off
- [ ] Stages 4-9 (orchestrator + VM swap) — design confirmed 2026-09-11; **next real test** is swap cutover (not bring-up)
- [x] Antevorta first install — complete 2026-09-11 (hub + runner healthy, Doug logged in). Runbook: `lockhouse/producer/docs/hapi-vm-bringup.md`
- [x] Antevorta in-place upgrade test — **PASS 2026-09-13** (9622798 → cd7d515, state/token/login survived, see §4). Caveat: no active sessions during the swap — drain-under-load unproven
- [ ] Antevorta VM swap rehearsal (full disk reattach to a new VM root) — not started
- [ ] Drain-under-load test (upgrade with `WORKING` sessions in flight) — not started, the real remaining gap on antevorta
- [x] Janus `in-svc-01` in-place upgrade test — **PASS 2026-09-13**, same artifact bump as antevorta (9622798 → cd7d515), same result (state/token survived), see §4. Confirmed untangled from the blocked official IN-zone network rebuild (bridges/CIDR) — that's a separate host-network process, not touched. VM stopped again afterward, not running 24/7 yet. Same drain-under-load caveat as antevorta
- [x] **Two-host proof (2026-09-13):** persistent-volume + in-place-upgrade design confirmed on two independent physical hosts (antevorta, janus), not just one
- [x] Quiesce resolved 2026-09-11 (Gavin sign-off): reuse `hapi-restart-hub`'s existing patient drain unchanged
- [x] Stage 0 automation (2026-09-11): `hapi-driver-rebuild --build-web --verify` on oos publishes soup single-exe artifacts
- [x] Pet-install cheat sheet (§6) — **VERIFIED 2026-09-13** after two rewrite rounds across three independent fresh-box tests (CTID 9001 fail → CTID 9002 partial-fix-with-new-bugs → CTID 9003 clean). See §6 for full detail

## 6. Self-upgrade path for non-fleet ("pet") installs — new 2026-09-13

Everything above (Stages 0–9) is the **cattle** path: fleet-managed shards, orchestrator says GO, VM gets swapped. There's a second, deliberately different case: a **pet** install — a single machine someone stood up by hand (a VPS, a fresh Linux box, a Chromebook's Linux/Crostini container) that has no orchestrator and no persistent-volume swap mechanism, but still needs to pick up new HAPI versions. The operator's ask: that machine runs **one command**, self-upgrades in place from "whatever's latest in our estate," no operator/orchestrator involved.

**What this needs, not yet built:**

1. **A public, stable place to fetch the artifact from** — the existing publish target (`/var/lib/hapi/soup-artifacts/` on oos-linux) only works for boxes with tailnet/SSH reach to oos. A pet install (Chromebook, someone else's VPS) has neither. **Recommendation: GitHub Releases on `heavygee/hapi`** (this fork, not a new repo/rebrand — release assets are fork-scoped metadata the same way `docs/plans/` is, they don't touch the upstream-verbatim PR surface). Reuse the existing tag scheme (`hapi-soup-v<YYYY.MM.DD>-<7-char-tip>`), attach the per-platform single-exe binaries + `manifest.json` as release assets, auto-published as an extra step alongside the existing oos `soup-artifacts` publish (same trigger: `hapi-driver-rebuild --build-web --verify`, or the manual `hapi-soup-publish-single-exe`). Gets versioning, CDN-backed downloads, and a stable `.../releases/latest` URL for free — no new hosting infra.
2. **A self-upgrade command** — something like `hapi upgrade`: check `hapi-soup-*` releases on `heavygee/hapi` for the newest tag, download the asset for the running platform, verify it (checksum from `manifest.json`), and perform the exact in-place swap-and-restart sequence just proven by hand on antevorta (stop → replace binary → restart, patient-drain if sessions are active). This is genuinely new code — nothing like it exists yet; the antevorta test was done by SSHing in and doing each step manually.
3. **A third test target to prove it** — a stand-in "pet" VM/environment (could literally be a Linux container simulating a Chromebook's Crostini setup) that has *only* the self-upgrade command and no operator access, to prove the self-service path actually works end-to-end, not just that a human with SSH can replicate the steps.

**Third test target — built and passed, 2026-09-13.** `pet-chromebook-sim`, a disposable Debian 12 LXC container on janus (CTID 9000, `192.168.86.18`) — deliberately zero cattle machinery: plain `pet` user, `HAPI_HOME=/home/pet/.hapi` on the container's own root disk (no LVM, no separate volume, no systemd unit, no Tailscale, no Lockhouse identity), hub+runner launched via bare `nohup`. Matches a hand-set-up Chromebook Crostini install as closely as an LXC container can.

**In-place upgrade — PASS**, same artifact bump as antevorta/janus (`9622798` → `cd7d515`): `/health` unchanged, `cliApiToken` byte-identical, machine ID unchanged, session/machine counts unchanged (0/1), binary sha256 matched each tag's manifest, new PIDs confirmed after `pkill -u pet -f` + relaunch. **Three-for-three** across cattle (antevorta, janus) and pet (this container) paths — state survives an in-place upgrade regardless of which path stood the machine up, for the same underlying reason in both cases: nothing gets destroyed mid-upgrade.

**Real gaps this surfaced, specific to the pet path (not cosmetic — feed into the `hapi upgrade` build):**
1. `hapi runner start-sync --workspace-root <dir>` refuses to create a missing directory (`path does not exist or is not a directory`) — cheat sheet needs `mkdir -p` before launch.
2. **No self-healing.** Cattle gets `Restart=on-failure` for free from systemd; a bare `nohup` process that crashes on its own (not during a deliberate upgrade) just stays down until the user notices. Real gap for an unattended pet install.
3. **No log rotation** — `~/.hapi/logs/*.log` grows forever under plain `nohup`; cattle gets this for free via `journalctl`.
4. Stopping the old process by `pkill`-ing on command-line pattern works but is fragile as a *general* mechanism — a real `hapi upgrade` command should track its own known PID, not grep for itself.
5. **Not tested:** actual agent-CLI OAuth login survival (only HAPI's own token/DB/machine-id was proven to survive) — same class of honesty caveat as the cattle tests' drain-under-load gap, flagging rather than implying full coverage.

Container is still up and available as a dev target for the meta-bot's `hapi upgrade` build work.

**Confirmed 2026-09-13 (operator sign-off):** GitHub Releases on `heavygee/hapi`, per the recommendation above. Proposed to the meta-bot as a build ask the same day (same pattern as Stage 0's automation).

**Meta-bot ack (2026-09-13):** picked up, scope confirmed, no dispute. Notes a smaller starting point than "build from scratch" — a hub-driven self-upgrade primitive already exists (`cli/src/upgrade/selfUpgrade.ts`, the `hub-artifact` channel: download-by-URL+sha256, verify, swap own binary), just wired to a hub-pushed tailnet/SCP offer, not a public GitHub URL. Proposed build order:
1. **GitHub Releases mirror** (smaller, do first) — extend the existing publish step to also `gh release create`/`upload` on `heavygee/hapi`, tag `hapi-soup-v...`, assets = `manifest.json` + every `dist-exe/bun-*` binary (this already covers arm64 — no separate arm64 ask needed, the asset list is "every platform the build produces," not just linux-x64)
2. **Standalone `hapi upgrade` for pets** — reusing the existing artifact-swap primitive above, pointed at the new public release URL instead of a hub-pushed offer

**Cheat sheet status: VERIFIED, 2026-09-13** (after two rewrite rounds — see collapsed history below).

Round 1 (fresh LXC `pet-firsttimer-sim`, CTID 9001) found the original did **not** get a real first-timer to a working install — full findings collapsed below. Round 2 fixes (correct per-platform path, `nvm` for Node/npm) were re-tested from scratch on a **third, independent fresh box** (LXC `pet-rewrite-test2`, CTID 9003, janus, `192.168.86.90`, no `sudo`, nothing pre-installed) — every step followed literally:

- Steps 1–6 (arch check → fetch from the corrected `soup-artifacts/latest/<platform>/hapi` path, no rename needed → no-`sudo` install fallback → directories created before launch → hub up without `--relay` → `/health` ok) — clean, no deviations.
- Step 7 (`nvm` → Node 22 → `npm install -g @anthropic-ai/claude-code`) — clean: no `EACCES`, no `EBADENGINE`, no root needed. (One thing that looked like a gap during testing — sourcing `~/.bashrc` non-interactively didn't load `nvm` — turned out to be a testing-harness artifact: Debian's stock `.bashrc` has `[ interactive ] || return` at the very top, and my test shell wasn't interactive. Confirmed via nvm's own direct `NVM_DIR`/`nvm.sh` export, which is unaffected by that guard. A real person's real terminal is interactive and doesn't hit this — not a cheat-sheet gap, verified rather than assumed.)
- Step 8 (`hapi --print "hello"`) — reproduced the exact documented `Not logged in · Please run /login` failure mode (deliberately did not spend a real Anthropic OAuth login on a disposable test box — same boundary as round 1, this time by explicit operator/peer sign-off rather than a judgment call made solo). Completing that login is a separately-proven mechanism (done for real on antevorta/Doug's install), not something that needed re-proving here.

Net: three independent fresh-box tests total, named for auditability — **CTID 9001** (`pet-firsttimer-sim`, round 1, failed: the 10-item findings list above), **CTID 9002** (`pet-rewrite-test`, first rewrite pass, found two new bugs the rewrite itself introduced: the wrong per-platform artifact path, and `npm install -g` hitting the same no-`sudo` `EACCES` wall the rewrite had just solved one step earlier for installing `hapi` itself — both fixed in the doc immediately after, same day), **CTID 9003** (`pet-rewrite-test2`, second rewrite pass, clean per above) — across two rewrite iterations. The instructions, followed literally with nothing silently fixed, get a real first-timer to a working install now.

<details>
<summary>First-timer test findings, 2026-09-13 (click to expand) — every gap the original cheat sheet had</summary>

1. Step "get the binary" pointed at `/var/lib/hapi/upgrade-artifacts/`, which has **no `latest` pointer** and ~90 files across two incompatible naming conventions — a first-timer being handed a file has no way to know if it's current.
2. Downloaded artifacts are named `hapi-soup-v...-linux-x64-baseline`, not `hapi` — the original's `chmod +x hapi` silently assumed a rename that was never documented.
3. Bare Debian 12 has no `sudo` by default (`sudo mv` → `command not found`) — **unconfirmed whether this also affects real Crostini**, flagging as open, not asserting as a real gap.
4. **Real blocking bug:** the launch block redirected to `~/.hapi/logs/hub.log` but never created `~/.hapi` or `~/.hapi/logs` — followed verbatim, the hub never starts (`No such file or directory`).
5. **`--relay` fails silently:** `tunwg` errored (`flag provided but not defined: -log_level`, exit 2); hub falls back to `127.0.0.1`-only with just a buried log line. This is the entire reason a Chromebook user would use this flag (reaching the hub from another device) — flagging as a real bug for the meta-bot, not just a doc gap.
6. The documented verification (`curl localhost:3006/health`) returns `ok` regardless of whether `--relay` actually works — gives a first-timer zero signal anything is wrong.
7. **The single biggest gap:** `hapi auth login` (as originally documented) is for connecting to a *remote* hub — irrelevant on a fresh single-machine install, where the hub's own token is auto-generated with zero action needed. The original cheat sheet **never installed or authenticated the actual agent CLI (Claude Code) at all**. A first-timer passes every documented check and still can't use HAPI: `hapi --print "hello"` → `Claude Code CLI not found on PATH`.
8. `hapi hub --help` doesn't show help — tries to start a second hub, fails on port conflict.
9. "Repeat steps to upgrade, restart the process" never said how to find/stop the already-running background process — naively re-running the launch command fails (`port 3006 in use`) because the old `nohup`'d process is still running with no supervisor.
10. No way to positively confirm an upgrade worked — `/health` exposes no version/tag.

</details>

*Today (manual — no public download exists yet, GitHub Releases mirror above isn't built):*

```bash
# 1. Check architecture first — determines which binary to grab
uname -m   # x86_64 → linux-x64, aarch64 → linux-arm64

# 2. Get the binary from someone with oos-linux access (no self-serve path yet).
#    Ask for the SOUP-ARTIFACTS mirror, not upgrade-artifacts (that one has no `latest` pointer).
#    CONFIRMED layout (2026-09-13, corrected after the flat-file path below was found not to
#    exist): "latest" is a directory with a PER-PLATFORM SUBDIRECTORY, not a flat file:
#      /var/lib/hapi/soup-artifacts/latest/linux-x64-baseline/hapi     (x86_64)
#      /var/lib/hapi/soup-artifacts/latest/linux-arm64/hapi            (aarch64)
#    The file at that path is already named plain `hapi` — no rename needed if you got it
#    from here. (If someone instead hands you a file from the OLDER upgrade-artifacts/
#    mirror, it WILL be named hapi-soup-v...-linux-x64-baseline — rename that to `hapi`.)
#    (transfer however reaches the box — scp if tailnet-joined, otherwise hand it over)

# 3. Install
chmod +x hapi
sudo mv hapi /usr/local/bin/hapi
# No `sudo` on this box? `mkdir -p ~/.local/bin && mv hapi ~/.local/bin/ && export PATH="$HOME/.local/bin:$PATH"`
# (add that export to ~/.bashrc too) — confirmed working on two separate no-sudo test boxes

# 4. Create EVERY directory the hub needs before first launch — it does not create these itself
mkdir -p ~/.hapi/logs ~/.hapi-workspace
export HAPI_HOME=~/.hapi        # add this line to ~/.bashrc too, or it won't persist next login

# 5. Launch WITHOUT --relay for now (known bug: it fails silently, see findings above —
#    you'll get a local-only hub with no error, which is fine for same-machine use but
#    will NOT be reachable from another device until that bug is fixed)
nohup hapi hub > ~/.hapi/logs/hub.log 2>&1 &
# or a systemd user unit per docs/guide/deployment.md:
#   ExecStart=/usr/local/bin/hapi hub

# 6. Confirm the hub itself is up (this only proves the hub, NOT that an agent can run yet)
curl localhost:3006/health

# 7. Install and connect the actual agent CLI — HAPI does not do this for you, and
#    (confirmed 2026-09-13) HAPI's own docs don't either: docs/guide/installation.md's
#    Prerequisites section only tells you to VERIFY Claude Code is already present
#    (`claude --version`) and links out to Anthropic's own docs — no install/auth
#    commands anywhere in the HAPI docs, unlike Grok Build which does get documented
#    auth steps.
#
#    CONFIRMED 2026-09-13: `npm install -g @anthropic-ai/claude-code` alone is NOT enough —
#    a bare Debian box has no Node.js at all, or a too-old stock one (Debian ships v18,
#    the package needs v22+, EBADENGINE), AND global npm installs need root/sudo the exact
#    same non-sudo user this cheat sheet already had to route around in step 3. Use nvm,
#    which installs a fresh Node under $HOME with no sudo needed, solving both at once:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or open a new shell — nvm needs its init lines sourced first
nvm install 22
npm install -g @anthropic-ai/claude-code
claude   # first run walks you through OAuth login interactively
# Headless/no-browser box (no display to complete OAuth in-terminal):
#   claude setup-token   # prints a URL + waits for a code — this is a REAL Anthropic
#                         # account login, not something to run against a throwaway
#                         # test box without meaning to actually authenticate

# 8. Real end-to-end check: can HAPI actually spawn the agent?
hapi --print "hello"
# Two DIFFERENT failure modes here, confirmed distinct 2026-09-13 — don't conflate them:
#   "Claude Code CLI not found on PATH"  → step 7's install never happened / not on PATH
#   "Not logged in · Please run /login"  → installed fine, just not authenticated yet
# The hub being healthy (step 6) does NOT mean either of the above is done — this is the
# check that actually matters.
#
# Expected, not a bug: the FIRST successful `hapi --print`/session-start auto-spawns a
# runner process as a side effect, even though no step above ever says to start one
# separately. If you see an extra process appear here, that's normal.
```

**To update, today:**

```bash
# 1. Find and stop the currently running hub/runner — there is no supervisor to do this for you
ps aux | grep -E "hapi (hub|runner)"
kill <pid>   # for each hapi hub / hapi runner process found — NOT pkill by pattern, confirm the PID first

# 2. Repeat steps 2-3 from install above (get the new binary, rename, chmod, move) —
#    this OVERWRITES /usr/local/bin/hapi (or ~/.local/bin/hapi), same file path as before

# 3. Relaunch exactly as in step 5 of install above

# 4. Confirm it's actually the new version — there is currently no version string in
#    `curl localhost:3006/health` to check this against. Until that's added (flagged to
#    the meta-bot), the only way to confirm is asking whoever gave you the file what the
#    tag/sha256 was and comparing `sha256sum /usr/local/bin/hapi` yourself.
```

No `hapi upgrade` command exists yet — this is the manual re-fetch-and-swap, same underlying mechanism proven by hand on antevorta/janus, but written out at the level of detail an actual first-timer needs, not an expert doing it from memory.

*Once the meta-bot's build lands:*

```bash
# Install
curl -L https://github.com/heavygee/hapi/releases/latest/download/hapi-linux-<arch> -o hapi
chmod +x hapi && sudo mv hapi /usr/local/bin/hapi

# Update, forever after
hapi upgrade
```
