# HAPI instance bring-up checklist

**Why this exists:** ninja (2026-09-22) got reported "healthy" and "done" multiple times —
hub/runner connected, `/health` green, Tailscale serve verified — while zero agent CLIs
were installed and the Cursor credential sync nobody ever actually ran. Every check that
ran was real; the set of checks was incomplete. This is the fix: a single checklist that
defines what "done" actually means, so any agent (or the operator) doing this can track
exactly what's been done and what hasn't, and so "healthy" stops silently meaning
"the parts I happened to check are healthy."

**Use this for:** any persistent, systemd-managed HAPI instance — antevorta, `in-svc-01`,
ninja, and whatever comes next. Not for the standalone pet-install path (`scripts/install-hapi-pet.sh` +
`docs/guide/pet-install.md` — that's a different, self-contained flow with its own checks).

**How to use it:** copy the checklist below into your working notes (or the plan/handoff
doc for this instance) at the start of a bring-up, and check items off as you actually
verify them — not as you assume them. An item is only checked if *you* ran the command
and saw the expected output, not because a prior phase "should have" made it true.

---

## Phase 0 — Host & capacity

- [ ] Confirmed target host has enough free RAM for the new VM **with margin**, not just
      "free ≥ requested" (checked actual `MemAvailable`, not configured-vs-used)
- [ ] Confirmed target host has enough disk for root + data volumes
- [ ] If freeing capacity by stopping another VM: confirmed with the operator it's safe to
      stop (a VM's own "throwaway" label is a hint, not a substitute for asking)

## Phase 1 — VM creation

- [ ] VM created with correct network bridge (verify the bridge is actually up —
      `vmbr-in` looked configured on janus but was carrier-down; `vmbr0` was the real one)
- [ ] Static IP chosen — **verified free via the router's actual reservation table**
      (`ip bindmac show` equivalent), not just ARP/ping. A device that's merely powered
      off will look "free" on ARP and still be reserved and traffic-blocked.
- [ ] If the network requires a manual binding (MAC reservation, DHCP static lease, VLAN
      tag) — that's done and confirmed, not just requested. This is the step most likely
      to need a human with router/switch admin access that no agent has.
- [ ] Boot firmware matches what the OS installer actually wrote (UEFI vs SeaBIOS/legacy —
      a debootstrap install defaulting to legacy grub on a VM configured for OVMF will not
      boot; check this before assuming "VM won't boot" is something else)
- [ ] VM boots, SSH reachable over LAN

## Phase 2 — Data volumes

- [ ] Second disk (or partition) attached for persistent state, **separate from the OS
      root disk** — root disk is throwaway, this isn't
- [ ] Split into (at minimum) two mount points: one for `HAPI_HOME` (DB, settings,
      `cliApiToken`), one for agent working directories/sessions — whether via LVM on one
      disk or two separate disks, both are fine; the point is a runaway agent workspace
      cannot starve the DB of space
- [ ] Dedicated service user created (not a personal account) if this is meant to run
      unattended — correct ownership on both mount points

## Phase 3 — HAPI install

- [ ] Latest binary fetched from the GitHub Releases mirror (`heavygee/hapi`,
      `hapi-soup-v*` tag) — confirm which tag, note it somewhere durable for this instance
- [ ] `hapi-hub.service` + `hapi-runner.service` installed as systemd units, correct
      `HAPI_HOME`, correct `--workspace-root`
- [ ] Both services active; `curl localhost:3006/health` → `200`
- [ ] Runner actually shows as registered/connected on the hub (not just "service active" —
      confirm the hub's own view of the runner, e.g. `/api/machines`)

## Phase 4 — Network front door

- [ ] Tailscale joined — if the auth key is OAuth-client-issued, it will need
      `--advertise-tags=tag:...`; get the tag scheme from whoever administers that tailnet
      *before* attempting the join (a failed attempt due to a missing flag does not
      consume the key, but don't assume that for every key type)
- [ ] `tailscale serve` — if this errors "Serve is not enabled on your tailnet," that's a
      **tailnet-level admin console toggle**, not a device-side fix; get the enablement
      link clicked by whoever administers the tailnet, then retry
- [ ] Actually hit the public URL from *outside* the box (`curl https://<hostname>/health`
      from a different machine) — confirming serve locally is not the same as confirming
      the tailnet actually routes to it

## Phase 5 — Agent CLI (the step that got missed on ninja — do not skip this section)

**"Hub healthy" and "runner connected" prove HAPI's own plumbing works. They prove
nothing about whether an agent can actually run a session. Do this whole section before
calling the instance done.**

- [ ] At least one agent CLI is actually installed and on the PATH the runner's systemd
      unit uses (check the unit's `Environment=PATH=...` line — installing a CLI to a
      user's shell PATH does not mean the runner's PATH includes it)
- [ ] If reusing an existing credential rather than a fresh login: the canonical source
      copied over correctly (for Cursor: `~/.config/cursor/auth.json` from oos-linux is
      canonical — see `docs/tooling/cursor-auth-fleet-sync.md` for the full sync
      procedure, apiKey/accessToken/refreshToken all present, correct ownership/`600`
      perms on the target)
- [ ] The runner's systemd unit actually loads the credential into its environment
      (`EnvironmentFile=` pointing at the derived env file) — check `/proc/<pid>/environ`
      on the **running** process after a restart, not just that the file exists
- [ ] **Spawn a real session through HAPI and confirm the agent actually responds.** Not
      `agent --version`, not `agent status` — an actual session that produces a real
      response. This is the only check that proves the full chain (hub → runner →
      credential → agent binary → model) actually works end to end.
- [ ] If this instance is a fresh login (not a copied credential): the interactive
      OAuth/token step was completed by a human, not simulated or assumed

## Phase 6 — Sign-off

- [ ] Every box above is checked because *you* verified it, this session, not because an
      earlier report said so
- [ ] Instance's tag/version, IP, hostname, and what's still open (if anything) recorded
      somewhere durable — a plan doc, a handoff, this checklist copied into one

---

## Known gotchas (from real incidents, not hypothetical)

| Symptom | Real cause | Where this bit us |
|---|---|---|
| IP looks free (ARP/ping) but traffic to the gateway times out | Router has a MAC-reservation anti-spoofing policy; a device that's just powered off still holds its reservation | ninja, twice (`.60` then `.62`, both already bound to other devices) |
| Tailscale join fails on flag validation | OAuth-client-issued auth keys need `--advertise-tags=tag:...`; personal keys don't | ninja |
| `tailscale serve` says "not enabled on your tailnet" | Tailnet-level admin toggle, not a device setting | ninja |
| VM won't boot after OS install | UEFI/SeaBIOS mismatch between the VM's firmware config and what the installer wrote | ninja (fixed by matching `in-svc-01`'s known fixup) |
| Hub/runner report healthy but agent sessions fail | Nobody actually installed/authenticated an agent CLI — health checks don't cover this | ninja |
| `install-hapi-pet.sh`'s `--relay` silently falls back to local-only | `tunwg` binary version mismatch on `-log_level` flag; hub swallows the failure | tracked as [#148](https://github.com/heavygee/hapi/issues/148) |

## Related

- `docs/plans/2026-09-04-fleet-vm-swap-strategy.md` — the cattle/VM-swap design this
  checklist's Phases 1-4 are drawn from
- `docs/guide/pet-install.md` + `scripts/install-hapi-pet.sh` — the standalone/pet path,
  different flow, not covered by this checklist
- `docs/tooling/cursor-auth-fleet-sync.md` — full Cursor credential sync procedure
- Canonical VM bring-up runbook (separate repo): `lockhouse/producer/docs/hapi-vm-bringup.md`
  — **this checklist's Phase 5 (agent CLI) is not yet reflected there as of 2026-09-22;
  needs reconciling by whoever has write access to that repo.**
