# #1108 fleet upgrade rollout checklist (honest edition)

**Audience:** Meta / fleets deploying hub↔runner version governance after [tiann/hapi#1108](https://github.com/tiann/hapi/pull/1108) lands on main.  
**Status:** draft for collaboration with Peer `7d55ed21` (governance) + Peer #1203 (provenance).  
**Date:** 2026-08-10  
**Related:** zombie RPC runbook § in [`machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md); postmortem [`2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md`](./2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md); Happy #1118 (rpc-register fire-and-forget).

This is **not** vibes. Our soup dogfood proved advertised capabilities ≠ live `RpcRegistry`.

---

## 1. Assessment (Meta)

### Agree with Peer `7d55ed21`

| Claim | Meta verdict |
|-------|--------------|
| Teemo/proxmox "missing self-upgrade" was **ghost registry**, not missing binary | **Confirmed** (Netgear spawn dump + cursor-models 500 while list shows `running`) |
| Hub restart → `machine-alive` returns, `rpc-register` can be dropped | **Confirmed** (all machine RPCs missing: spawn / listCursorModels / self-upgrade) |
| Advertised `CURRENT_MACHINE_CAPABILITIES` overlay never strips → false upgrade attempts | **Agree** — upgrade gate must require **live** `hasMethod(machineId:runner-self-upgrade)` |
| Keepalive re-register heals **after** that CLI generation is on the host | **Agree** — chicken/egg for first generation |
| True legacy (`caps=None`, ancient binary) is a different case | **Agree** — manual install path |

### Extra estate landmines #1108 does **not** fix

- **#1473 untagged hosts:** runner restart can mint new `machineId` (Teemo/proxmox still untagged on this estate). Upgrade restart ≠ safe without tag pre-seed / migrate plan.
- **HTTP 200 + `type:error` spawn body:** operators/scripts that only check status code will "succeed" while spawning nothing.
- **`GET /api/machines/:id` 404:** route does not exist — not proof the machine is gone.
- **Soup-only:** `HAPI_DISABLE_VERSION_HANDOFF`, tip-forward heal warn-skip dropping `/cli/upgrade/cli-artifact` (SPA HTML served as binary — 2026-08-07), supervised `hapi-restart-hub` vs raw systemctl.

### What #1108 **is** for

Generation skew soft-fail, fleet self-upgrade when **live** RPC exists, cleaner `upgrade_unavailable` vs toast spam. Not machine-id migrate. Not provenance stamps. Not a substitute for one manual runner restart on first rollout.

---

## 2. Where documentation should live

| Surface | What to put | Owner |
|---------|-------------|-------|
| **Upstream PR #1108 body** (required before merge ask) | Short "Upgrade notes" + chicken/egg + kill-criteria (below) | Peer `7d55ed21` |
| **`docs/guide/deployment.md`** (or new `docs/guide/fleet-upgrade.md` in the PR) | Operator-facing npm + artifact channels; restart semantics; `KillMode=process` reminder | Peer `7d55ed21` (upstreamable) |
| **Release notes / npm package README blurb** | One paragraph: after hub upgrade, restart each runner once if upgrade shows unavailable | Peer + release owner |
| **Fork only:** this checklist + runbook zombie section | Estate soup landmines, #1473 interaction | Meta (`05d9f0f2`) |
| **Provenance (#1203)** | How agent-authored "restart Teemo" / upgrade nudges are attributed | Peer #1203 — Meta does not invent stamp UX here |

Do **not** bury the chicken/egg only in fork `docs/operator/` — clean fleets will never read that.

---

## 3. Main-landing rollout checklist (non-soup fleets)

### Channels

**A. npm / Homebrew (typical)**

1. Upgrade hub host CLI + restart hub (`hapi hub` / systemd / pm2).
2. On **each** runner host: `npm i -g @twsxtd/hapi@latest` (or brew) **or** let hub-artifact apply **only if** live self-upgrade RPC already works.
3. **First generation / ghost registry:** manually restart runner once:
   - systemd: `systemctl restart hapi-runner` (or user unit) with `KillMode=process`
   - Windows: restart the runner service / scheduled task equivalently
4. Wait ≤30s for keepalive / connect.
5. Run kill-criteria (§5).
6. Only then trust auto fleet-upgrade for subsequent generations.

**B. Hub-artifact channel (`/cli/upgrade/cli-artifact`)**

1. Confirm artifact URL returns a **real binary** (not SPA `index.html` / HTML content-type). Soup remat heal-skip has bitten this.
2. Hub must see **live** `runner-self-upgrade` before auto-apply; otherwise surface `upgrade_unavailable` (no toast spam).
3. After apply: runner mtime handoff / supervised restart; verify generation fingerprint + spawn RPC.

**C. True legacy (`caps=None`, ancient CLI)**

1. Manual install current CLI on that host.
2. Restart runner.
3. Do not expect hub auto-upgrade to invent the capability.

### Hub restart day (any channel)

```text
1. Announce maintenance window (runners will look "online" while RPCs may be empty).
2. Restart hub.
3. Within 60s: probe EVERY machine for live spawn + self-upgrade (see §5).
4. Any host failing probe → restart THAT runner only (not hub again).
5. Re-probe before enabling / trusting auto-upgrade loop.
```

---

## 4. Soup-specific landmines (our estate — not everyone's)

| Landmine | Why it matters for #1108 |
|----------|---------------------------|
| Primary soup `HAPI_DISABLE_VERSION_HANDOFF=1` | Intentional — fleet upgrade must not "fix" primary by enabling handoff |
| Demoted host `30-soup-artifact.conf` | Not soup parity; keep targetVersion current or remove |
| Tip-forward heal warn-skip | Can drop `/cli/upgrade/cli-artifact` remount → HTML-as-binary |
| `hapi-restart-hub` restarts runner on oos by default | Can clear oos registry too; use `--no-runner` when only flushing hub cache after SQL remap |
| Untagged Teemo/proxmox + #1473 | Runner restart for re-register can mint new machineId — pre-seed tag or accept remap |
| Multi-agent ops pings | "Restart Teemo" from an agent looks like operator intent — #1203 attribution needed |

---

## 5. Kill-criteria before claiming "smooth for others"

All must pass on a **representative remote runner** (not only the hub host):

```bash
# After: hub on #1108+ generation; runner restarted once onto that CLI (or keepalive heal live)

# 1) Machine still listed
curl -fsS -H "Authorization: Bearer $JWT" "$HUB/api/machines" \
  | jq -e --arg id "$MACHINE_ID" '.machines[]|select(.id==$id and .runnerState.status=="running")'

# 2) Live spawn RPC (parse JSON — HTTP 200 is not enough)
RESP=$(curl -fsS -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"directory":"/tmp","agent":"cursor","yolo":true}' \
  "$HUB/api/machines/$MACHINE_ID/spawn")
echo "$RESP" | jq -e '.type=="success" and (.sessionId|type=="string")'
# archive/abort the probe session afterward

# 3) Live self-upgrade path is callable OR cleanly unavailable
# Expect either upgrade progress OR code upgrade_unavailable with restart guidance —
# NEVER upgrade_failed toast from advertised-but-not-live caps.

# 4) Hub bounce resilience (post keepalive re-register ship)
# Restart hub only → wait 30s → WITHOUT restarting runner:
#   - spawn JSON success OR (if still ghost) upgrade_unavailable — not upgrade_failed
#   - within one keepalive period (~20s on tip) spawn must succeed again
```

**Refuse greenlight** if:

- Auto-upgrade fires `upgrade_failed` when registry empty but metadata advertises the cap
- Hub restart leaves remote runners spawn-dead for >1 keepalive + no operator-visible `upgrade_unavailable`
- Artifact download is HTML
- Checklist claims "zero manual steps" for first generation on ghost/legacy hosts

---

## 6. Concrete deltas Meta owns vs peers

| Delta | Owner | Status |
|-------|-------|--------|
| This checklist (fork) | Meta | **This doc** |
| Runbook zombie RPC + HTTP 200 body | Meta | Done `12a3cb2f9` |
| Commit ghost-RPC fixes on `fix/hub-runner-version-governance` | Peer `7d55ed21` | Uncommitted in WT — **ship before merge ask** |
| PR body Upgrade notes + guide section | Peer `7d55ed21` | Open |
| Provenance of upgrade/restart nudges | Peer #1203 | Open (ping them) |
| Operator-approved tagged Teemo/proxmox runner recycle on this estate | Meta + operator | Blocked on operator yes |

---

## 7. Open risks Meta refuses to greenlight

1. **"After #1108, fleets upgrade with zero restarts"** — false for first gen / ghost registry / true legacy.
2. **Trusting advertised caps for upgrade eligibility** without live registry check — ships toast spam and false confidence.
3. **Treating our soup dogfood as the only path** — npm fleets need guide text; soup landmines must be labeled soup-only.
4. **Rolling #1108 runner restart on this estate without #1473 tag plan** — will re-orphan proxmox/Teemo sessions.
5. **Agent-authored restart/upgrade instructions without provenance** — operators will execute ghost ops; #1203 must answer attribution before we automate cross-session upgrade nudges.

---

## 8. Immediate ops (pre-ship, this estate)

Already decided with Netgear:

- Leave WiFi mesh peer on oos.
- Do **not** bounce proxmox/Teemo until operator approves **tagged** heal.
- When approved: pre-seed `machineTag` ↔ hub `machines.tag`, restart runner only, probe §5, then allow auto-upgrade.
