# Soup + fleet ops: what we have vs what we can recommend

**Status:** internal operator reference (fork-only). **Not** upstream HAPI canon.  
**Audience:** operator, peer agents, anyone deciding what to copy from this fork.  
**Last updated:** 2026-06-27 (HAPI hub/runner OOMScoreAdjust=-1000 via server-setup earlyoom drop-ins).

---

## Executive summary

This fork runs **two overlapping systems**:

| System | What it is | Safe to show outsiders as "the HAPI way"? |
|--------|------------|-------------------------------------------|
| **Product HAPI** | Hub, runner, PWA, Telegram — install and remote-control agents | **Yes** — that is upstream's story |
| **Integration foundry** | Manifest soup on `driver/integration`, 30–50 live sessions, dogfood on `:3006` while doing paid work | **Not yet** as *the* definitive pattern |

We are **not** wrong to operate the foundry. We **are** wrong to present today's operational scars (reactive guardrails, incident-driven policy, single-host fleet thermodynamics) as finished guidance without tiering and caveats.

---

## What we have today (honest inventory)

### Architecture that works

- **Three-layer layout** — mirror (`~/coding/hapi`), feature worktrees (`worktrees/<name>`), daily driver (`driver/` on `driver/integration`). See [repo-layout-and-dev-flow.md](./repo-layout-and-dev-flow.md).
- **Manifest-driven soup** — `~/.config/hapi/driver-manifest.yaml` merges ordered layers onto `driver/integration`. See [driver-soup.md](../tooling/driver-soup.md).
- **Agent-safe web dogfood** — `hapi-driver-rebuild --build-web` atomic-swaps `web/dist` without hub restart.
- **Upstream PR discipline** — feature branches from `upstream/main`, `hapi-pr-create`, intake gates before operator dogfood.
- **Coordination primitives** — `hapi-driver-status`, flock on driver-stack mutations, patient `hapi-restart-hub`.

### Architecture that hurts at our scale

- **Single host, single `:3006` cockpit** — integration lab and production remote-control are the same hub. A bad merge or restart hits real work.
- **High session count** — dozens of concurrent HAPI sessions on one 32 Gi machine → swap pressure, earlyoom kills, zombie wrappers, orphaned MCP CPU spinners.
- **Soup depth** — 15–19 manifest layers; silent bad merges can pass `git merge` and only fail at hub boot or `--verify`.
- **Ownership drift** — multiple agents have run `hapi-driver-rebuild` / `hapi-restart-hub` (e.g. triage + tooling/meta collision, 2026-06-20). Policy says one owner; practice lagged.
- **Verify debt** — `hapi-driver-rebuild --verify` can fail on stacked-soup typecheck/test drift; promotion stamp then blocks `hapi-use-driver` until fixed.

### Guardrails added reactively (2026-06-19 – 2026-06-20)

These are **real** but **young** — they exist because incidents happened, not because a greenfield operator would discover them in order:

| Gate | Catches | Does not catch |
|------|---------|----------------|
| Compile pre-flight (conflict markers + hub store parse) | Syntax garbage, corrupt merge SQL | Logic bugs, failing tests |
| Promotion stamp (`~/.hapi/driver-promotion.json`) | Swinging unverified HEAD live | Stale stamp if driver moved on |
| Unified `stack.lock` | Parallel rebuild + switch + restart-hub | Hand-edits in `driver/`, `HAPI_SKIP_DRIVER_LOCK=1` |
| `hapi-driver-status --quiet` precheck | Busy stack (when scripts call it) | Agents that skip the script |

---

## What upstream / generic HAPI developers need (baseline)

A **recommendable** path for someone who is *not* running a 30-agent fleet on one box:

1. Install HAPI (extension or manual), one or a few agents.
2. Develop features in a **normal git branch** (or worktree), open upstream PR.
3. Optionally dogfood **web UI** via rebuild + browser reload.
4. Operator promotes **hub/cli** changes deliberately (restart window), not from every agent session.

That path is documented in upstream README + fork [new-feature-intake.md](../tooling/new-feature-intake.md). It does **not** require manifest soup, promotion stamps, or a dedicated soup keeper.

---

## What we should have before calling it *guidance*

Treat the following as a **readiness checklist**. Until most items are green for **30 consecutive days** without operator emergency intervention, label internal ops as **"lab — sharp edges"** not **"recommended default."**

### A. Process (organizational)

| # | Criterion | Today |
|---|-----------|-------|
| A1 | **Single soup rebuild owner** (feature peer promotes after operator soup approval; one flock at a time) | Partial — policy in lifecycle + driver-soup; peers still hand off incorrectly |
| A2 | **Triage vs integration separation** — meta/triage sessions never `rebuild` / `restart-hub` | Broken once (2026-06-20) |
| A3 | **Promotion is routine** — `rebuild --verify` → stamp → **`hapi-restart-hub`** on driver soup (or operator `use-driver` only for stack path swing) without `HAPI_PROMOTE_UNVERIFIED` | Blocked on verify debt |
| A4 | **Incident postmortems** captured in this doc or `driver-soup.md` when policy changes | Ad hoc |

### B. Technical gates (automation)

| # | Criterion | Today |
|---|-----------|-------|
| B1 | `hapi-driver-rebuild --verify` **green** on current manifest | **Red** (typecheck/test debt on stacked soup) |
| B2 | Unified stack lock deployed and sole path (no legacy `rebuild.lock` / `switch.lock` confusion) | Code landed; old lock files may linger |
| B3 | Compile pre-flight on rebuild, switch, restart | **Green** |
| B4 | Promotion stamp required for `hapi-use-driver` | **Green** (enforced; stamp may be stale) |
| B5 | `hapi-driver-status` exposes **which session** holds WORKING (not just count) | **Gap** — filed in driver-soup.md |

### C. Infrastructure (capacity)

| # | Criterion | Today |
|---|-----------|-------|
| C1 | Host memory headroom under normal fleet load (swap not pegged 24/7) | **Red** — recurring pressure |
| C2 | earlyoom / OOM policy: hub + runner protected (`OOMScoreAdjust=-1000`); agent fleet still killable | Fixed 2026-06-27; needs monitoring |
| C3 | Or: **tier-2 integration** — soup rebuilds against non-live hub port / second machine | **Not implemented** |

### D. Documentation (what we publish)

| # | Criterion | Today |
|---|-----------|-------|
| D1 | **Tiered guidance** — "minimal", "fork worktrees", "full soup fleet" as separate tracks | This document starts that |
| D2 | Fork operator docs clearly labeled **not upstream** | **Green** (`docs/operator/`) |
| D3 | Copy-paste runbook: one successful soup cycle end-to-end with expected timings | Partial (`driver-soup.md`) |
| D4 | Anti-patterns list with real incident dates | Partial (scattered) |

**Readiness rule of thumb:** call it guidance when **A1–A3**, **B1–B4**, and **D1–D3** are green and **C1 or C3** is green.

---

## What we can recommend *now* (tiered)

### Tier 0 — Any HAPI developer (share freely)

- Upstream install and single-agent remote control.
- Feature branch → PR → upstream review.
- Do not run `hapi-use-driver` / `hapi-use-worktree` from agent tool calls.

### Tier 1 — Fork contributor with one machine (share with caveats)

- Workflow: [feature-work-lifecycle.md](../tooling/feature-work-lifecycle.md)
- Manifest mechanics: [driver-soup.md](../tooling/driver-soup.md)

### Tier 2 — This operator's full soup fleet (internal only until checklist green)

- Deep manifest (10+ layers), many simultaneous sessions, dogfood hub/cli on live `:3006`.
- Dedicated soup keeper (`8c6b5a7d` tooling/meta or successor).
- Promotion contract + stack lock + patient restarts.
- Expect to maintain verify debt, session zombies, and memory policy yourself.

**Do not** point external HAPI developers at Tier 2 as the default onboarding path today.

---

## Anti-patterns (learned the hard way)

| Anti-pattern | What happened | Do instead |
|--------------|---------------|------------|
| Two agents `hapi-driver-rebuild` at once | Driver tree mid-merge; verify failures | One owner; `stack.lock` / status busy → wait |
| Triage session rebuilds + restarts hub | Stack busy; patient drain deadlock | Triage diagnoses; tooling/meta integrates |
| `hapi-restart-hub` after failed `--verify` | Hub reloads unverified tree | Fix verify first; then promote |
| Hand-merge in `~/coding/hapi/driver` | Silent SQL corruption → crash-loop | Manifest + rebuild only |
| 50 sessions on one box, swap full | earlyoom SIGTERM agents | Fleet limits; orphan cleanup; memory budget |
| Presenting soup as "step 3 in README" | Others copy pain they can't support | Tier 0/1 first; Tier 2 labeled lab |

---

## Near-term path to "guidance ready"

1. **Green verify** — `fix/soup-typecheck-followups` (or successor) until `hapi-driver-rebuild --build-web --verify` passes; stamp promotion.
2. **Enforce owner** — only tooling/meta (or operator) runs rebuild; triage/peers ping, don't execute.
3. **One clean soup cycle** — rebuild → verify → verify-web-dist → **`hapi-restart-hub`** (or operator stack swing if path changed) → no bypass; document timestamps in `driver-soup.md`.
4. **Memory budget** — either reduce concurrent sessions or add tier-2 integration host; stop living at swap=0.
5. **Promote stable bits upstream** — atomic web swap, stack lock, promotion stamp are candidates for fork docs → upstream contrib docs *after* burn-in.

---

## Related docs

| Doc | Role |
|-----|------|
| [feature-work-lifecycle.md](../tooling/feature-work-lifecycle.md) | **Master map** — all local dev topologies |
| [repo-layout-and-dev-flow.md](./repo-layout-and-dev-flow.md) | Layout and worktree model |
| [driver-soup.md](../tooling/driver-soup.md) | Manifest, rebuild, promotion contract, coordination |
| [new-feature-intake.md](../tooling/new-feature-intake.md) | Peer workflow and gates |
| [AGENTS.md](./AGENTS.md) | Fork agent canon (stack-switch rules) |

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-20 | Initial version — post stack-lock collision, promotion contract, verify-debt blockers |
