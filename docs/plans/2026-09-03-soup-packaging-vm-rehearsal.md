# Soup packaging VM rehearsal (janus throwaway)

**Date:** 2026-09-03  
**Session:** soup packaging remat rehearsal on janus (VM 2097 `oos-soup-rehearsal-test`)  
**Parent remit:** workmate version-parity / Doug Antevorta independent-hub packaging  
**Verdict up front:** **does not reproduce** via clone + `hapi-driver-rebuild`. A **frozen snapshot** of `driver/integration` (git tip / tree export, optionally plus built `web/dist`) is the honest distribution unit — not the tip-forward recipe alone.

Related: [`2026-08-20-workmate-version-parity-recommendation.md`](./2026-08-20-workmate-version-parity-recommendation.md), [`../tooling/driver-soup.md`](../tooling/driver-soup.md).

---

## 1. What we tested

Goal: rehearse packaging HAPI **soup** onto a fresh machine we control (janus), before offering Gavin-stream soup development to a colleague on a separate box (Doug / Antevorta). Crux: tip-forward remat is documented as **non-deterministic run-to-run**; is “here’s the manifest, rebuild it” a distributable package?

**Not tested (out of remit):** standing up a second production hub against the fleet; registering a runner on `hapi.tail9944ee.ts.net`; Antevorta bare-metal bring-up (owned by a sibling session).

---

## 2. Environment

| Item | Value |
|---|---|
| Hypervisor | janus (`qm`), storage `pool-oos` (~924 GiB free at start) |
| VMID | **2097** (left **2099** free for antevorta dry-run) |
| Name | `oos-soup-rehearsal-test` |
| Spec used | 4 vCPU / 8 GiB RAM / 64 GiB disk |
| Spec requested (late correction) | “as small as practical” — ~2 vCPU / 2–4 GiB / 16–20 GiB |
| Sizing note | VM already mid-test when the smaller-spec correction landed; **kept** the existing VM and recorded the deviation rather than redo. Future concept-proof VMs should start at the smaller footprint. |
| Network | DHCP preferred; **DHCP produced no usable lease** in practice. Offline netplan static **192.168.86.197/24** unblocked SSH. Document as a rehearsal friction, not a product requirement. |
| Guest image | Debian 12 genericcloud (same cache as oos-linux create script) |
| Baseline oos soup tip (re-verified) | `46f3330018c35560fd98b180d8ee60c20398814f` — *Merge branch 'driver/in-session-content-search' into driver/integration-wip* |
| Baseline tree OID | `d2a693b47b409d84ffb2b00173dbf6da8b09bdd4` |
| oos local manifest layers | **50** (working tree dirty vs `origin/main`) |
| `origin/main` manifest layers | **48** |

Guardrails honored: no writes to VMs 2001/2002; no IN-scope `10xx` VMIDs; no production-hub runner registration; no merges on `tiann/hapi`.

Throwaway scripts landed in `janus-oos`: `scripts/dryrun-oos-soup-rehearsal-vm.sh`, `config/proxmox/oos-soup-rehearsal.env.example` (disk-0 importdisk fix vs older `disk-1` assumption).

---

## 3. Portability blockers (flagged; not silently patched into product)

These blocked a clean “clone + remat” on a virgin host. Workarounds used only on the throwaway VM.

| # | Assumption | What happened | Honest packaging implication |
|---|---|---|---|
| 1 | `HAPI_SESSION_ID` for remat lease | Rebuild exits unless a session id can claim `~/.hapi/remat-owner.lease` | Operator/TTY packaging needs a synthetic id or a documented lease-free operator path |
| 2 | Non-TTY merge-only rebuild refused | Agent guard: must `--build-web --verify` or set `HAPI_OPERATOR_DRIVER_REBUILD_MERGE_ONLY=1` | Fresh-host checklist in `operator-lock.md` under-states this; merge-only is a special case |
| 3 | Layer refs are **local branch names**, not `origin/<name>` | `resolve_merge_ref` does `rev-parse $ref` only — fresh clone has remotes, not locals | Must localize `origin/*` → local branches (or teach rebuild to fall back to `origin/$ref`) |
| 4 | **5 manifest layers not on `origin`** | `feat/garden-route`, `feat/relative-time-upto-year`, `fix/garden-voice-orb-routing`, `fix/claude-mcp-spawn-model-effort`, `driver/a2a-nametag-attribution` exist only as oos worktree/local branches | **Published recipe is incomplete.** Required a 107 MiB `git bundle` from the soup host |
| 5 | oos manifest dirt | Local `config/driver-manifest.yaml` has **50** layers; `origin/main` has **48** (extra: in-session content search + peers search + related) | Even “the kitchen’s recipe file” is not what a GitHub clone sees |
| 6 | Balloon / RAM | With `--balloon 2048` guest saw ~1.8 GiB until balloon cleared + hard restart | Concept-proof VMs: balloon 0 or omit |
| 7 | Cloud image has no `qemu-guest-agent` | `qm guest cmd` / DHCP discovery via agent failed | Install agent in guest or use static IP / serial |

---

## 4. Remat results

### A. Fresh clone + tip-forward from `upstream/main` (documented default)

After localizing published branches + importing the 5 unpublished ones via bundle:

- Started at `upstream/main` @ `980a921b…`
- **Failed on layer 1/48** — merge conflict in `web/src/components/assistant-ui/mermaid-diagram.tsx` merging `feat/mermaid-parse-failure-feedback`
- Live tip correctly left unchanged; remat hold set on the throwaway guest only

**Interpretation:** tip-forward on oos starts from a **green soup tip** that already absorbed history + kitchen `rerere` / heal state. A second kitchen replaying “the recipe” from bare upstream is a different algorithm than daily tip-forward, and it **does not** recreate the dogfood tip.

### B. Frozen soup tip planted on the VM

- Bundled oos `driver/integration` @ `46f333001…` onto the guest
- Resulting **commit SHA and tree OID matched oos exactly** (`46f333001…` / `d2a693b47…`)

**Interpretation:** bit-identical soup **source tree** is achievable by shipping the composed tip (bundle / mirror / tagged export), not by rematerializing.

### C. Tip-forward *from* that planted tip (second-kitchen absorb)

- Most layers skipped as already ancestors (expected)
- Fat-tip gate **SKIP**’d several layers (`driver/session-attached-jobs`, `driver/cursor-notify-rule-delta`, `driver/kitchen-status-session-list`, `feat/display-links`, …) — same class of tip-forward non-determinism / incompleteness as on the primary kitchen
- Post-merge heals: many **warn-skipped** with conflicts under tip-forward
- Subsequent web build path failed (`mdast-util-from-markdown` resolve); atomic remat **rolled live tip back** to `46f333001…`

**Interpretation:** even starting from the good tip, a second-host remat is not a no-op “refresh” — heal/fat-skip behavior diverges, and build tooling assumptions (full `bun install` / dist) still bite. The snapshot tip itself survived only because rollback restored it.

---

## 5. Recommendation (snapshot vs recipe)

| Distribution unit | Viable for Doug independent hub? |
|---|---|
| “Clone `heavygee/hapi` + run `hapi-driver-rebuild`” | **No.** Incomplete remote refs, local-ref assumption, cold merge conflicts, tip-forward ≠ full-recipe history |
| Manifest-as-recipe alone | **No.** Tip-forward is explicitly non-deterministic; fat skips + heal warn-skips drop layers |
| **Frozen `driver/integration` tip** (git bundle / mirror of known-good SHA + tree) | **Yes** for source parity — proven bit-identical in this rehearsal |
| Tip + built `web/dist` (or image with deps installed) | Prefer for a runnable hub; this rehearsal stopped at source-tree parity by design |

**Plain recommendation:** treat soup packaging as **export a known-good composed tip** (and preferably a verified web artifact), versioned/tagged at a dogfood-green moment. Do **not** tell Doug “rebuild from the manifest on your box” and expect oos parity. Shared-hub (Option C in the 2026-08-20 note) remains correct when organizational constraints allow it; when Doug must run an independent hub, ship a **snapshot**, not a **recipe**.

Optional follow-ups (not done here):

1. Push or bundle the five unpublished layer branches so `origin` matches the kitchen (recipe hygiene — still won’t make remat deterministic).
2. Teach `resolve_merge_ref` to fall back to `origin/$ref`.
3. Document a `HAPI_REMAT_MODE=full-recipe` + pinned layer SHAs format if recipe distribution is ever required (different product from today’s tip-forward kitchen).
4. Concept-proof VM template: 2 vCPU / 4 GiB / 20 GiB, balloon 0, static IP or guest-agent in image.

---

## 6. Cleanup

- Throwaway VM **2097** destroyed after this write-up (or kept only if operator asks).
- No production hub/runner changes.
- No upstream merges.

---

## 7. Evidence crumbs

```text
oos tip:  46f3330018c35560fd98b180d8ee60c20398814f
oos tree: d2a693b47b409d84ffb2b00173dbf6da8b09bdd4
vm tip:   46f3330018c35560fd98b180d8ee60c20398814f  (after snapshot plant + failed remat rollback)
vm tree:  d2a693b47b409d84ffb2b00173dbf6da8b09bdd4
origin/main layers: 48
oos dirty manifest: 50
cold remat: conflict layer 1 feat/mermaid-parse-failure-feedback
```
