# Should a workmate run the "same HAPI version" as this estate? (recommendation)

**Asked by:** operator, via orchestrator (`/sessions/05d9f0f2-9273-4137-933c-07459a1146a2`)
**Date:** 2026-08-20
**Verdict up front:** usually **no rebuild needed** — point the workmate's client at the shared hub. Full local soup parity is only worth it if they're going to actively develop soup-only features or run a genuinely independent hub. See §4 and §6.

**2026-09-03 addendum — operator decision for the live case (Doug/Antevorta):** the situation moved into the §4 exception. Doug's Antevorta is a genuinely independent hub, not a shared-hub client — but the operator picked that path for **organizational**, not technical, reasons that this doc didn't originally weigh: (1) Doug's installation is out-of-scope for this estate and an in-scope install is a separate future move; (2) more decisively, the operator does not want to be "a single point of failure for [Doug's] stuff being up for them doing work." That's an availability/blast-radius argument this doc's §4 didn't cover — §4 asked "does this workmate need independent-hub capability," not "should the operator's uptime be a dependency of someone else's work." Given that framing, Option A (local rebuild) is the deliberate choice even though its cost/risk in §3 stands unchanged and is being accepted, not overlooked — see the packaging rehearsal spawned to test whether it's actually deliverable: `docs/plans/2026-09-03-soup-packaging-vm-rehearsal.md` (or successor filename — check the peer session `b5459065-e1a1-45cb-93ea-b77c3bed59cd` for the actual doc once written).

---

## 1. What "same version" could mean here

At least five distinct things collapse into the phrase "same version," and they move independently:

| Axis | What it tracks | Current value (verified) |
|---|---|---|
| **semver** | `cli/package.json` string | `0.28.0` — **identical** on fork `main` and on `driver/integration`. Does not encode which of the 42 soup layers are present. |
| **soup tip SHA** | HEAD of `~/coding/hapi/driver` (branch `driver/integration`) | `175105f0e` — `merge(soup): driver/fleet-runner-upgrade — keep displayLinks + version commands`, 2026-08-18 18:40:25Z |
| **CLI artifact fingerprint** | Built binary served over `/cli/upgrade/cli-artifact` or published to npm | Not currently built on this driver checkout (`driver/cli/dist` absent — needs `hapi-driver-rebuild --build-web --verify` or a CLI-only build step to produce one) |
| **hub-target skew** | What the hub advertises as `targetVersion` vs what a runner's live CLI reports | Not probed here (out of remit — that's the #1108 governance track, see `docs/plans/2026-08-10-1108-fleet-upgrade-rollout-checklist.md`) |
| **npm vs hub-artifact vs soup source tree** | Three different distribution channels for the *same* semver number | npm `@twsxtd/hapi@0.28.0` = vanilla upstream release. Hub-artifact = whatever binary the soup host last built. Soup source tree = 42-layer composed checkout. All three can legitimately report `0.28.0` while running materially different code. |

**Fork `main` vs `driver/integration` are different objects with different jobs:**

- **Fork `main`** (`~/coding/hapi`, this mirror) = `upstream/main` + fork-only docs/plans/tooling, kept truthful by `hapi-sync-fork-main`. It is the **recipe host** — `config/driver-manifest.yaml` lives here — not a runnable product distinct from upstream.
- **`driver/integration`** (`~/coding/hapi/driver`) = the **composed product**: base + 42 manifest layers, merged by `hapi-driver-rebuild`. This is what `:3006` serves.

Sharing a semver string is not sharing a codebase. Treat "0.28.0" as a base-release marker, not a parity signal.

---

## 2. Does fork `main` == soup? No.

Mechanically: `hapi-driver-rebuild` reads `config/driver-manifest.yaml` (tracked on fork `main`), checks out `upstream/main` as base inside `~/coding/hapi/driver`, and merges each `- branch:` / `- pr:` layer in manifest order onto `driver/integration`. Fork `main` itself never accumulates those layers — it stays `upstream/main`-shaped plus non-code fork docs (`docs/tooling/driver-soup.md` § "Keeping fork main truthful").

So: `git clone heavygee/hapi && git checkout main` gets a workmate **vanilla upstream HAPI** (currently 823 commits ahead / 17 behind `upstream/main` — see §5, the fork mirror itself needs a sync). It does **not** get:

- Any of the 42 in-flight soup features (session-jobs, github-pr-awareness, Garden route, fleet-runner-upgrade, etc.)
- Whatever `:3006` is actually running right now (`driver/integration` @ `175105f0e`, 1352 commits ahead of `upstream/main` on that branch)

A workmate on fork `main` and the operator's dogfood instance are running **different products that happen to both self-report `0.28.0`.**

---

## 3. What it would take to match soup — options

| Option | Cost | Risk | Gets you |
|---|---|---|---|
| **A. Same manifest + rebuild on their own machine** | High: install full driver-soup tooling (`hapi-driver-rebuild`, flock/remat-hold protocol, `hapi-manifest-mirror-to-config.sh`, systemd soup-host conventions), disk + CPU for a 42-layer merge, DB schema step-migration awareness if they also run a hub | Real: fat-tip layers, tip-forward heal warn-skips, hot-file collisions (`rpcGateway.ts`, `SessionList.tsx`, etc.) are all things *this* estate has hit repeatedly and built guards for — a second kitchen re-derives the same failure modes independently | Exact **point-in-time** code parity — but soup is a moving target maintained by ~30 agents; parity decays the instant either side rebuilds |
| **B. Hub-artifact / npm `@twsxtd/hapi@…` channel** | Low: `npm i -g` or fetch the artifact URL | Low, but: gets **only** the published upstream release — none of the 42 fork-only layers | Same semver, materially different feature set. Fine if the workmate only needs vanilla HAPI. |
| **C. Point at the shared hub only (remote control); local CLI can differ** | Lowest: connect a runner client (or just use remote control / browser) against the existing oos-linux hub over Tailscale | Effectively none — this is the **existing, documented pattern** for every non-soup fleet machine (homelab, Windows laptops): "Ordinary fleet machines… are runners only" (`driver-soup.md` § Soup hosts vs fleet Upgrade) | The actual running features, with zero local build burden. Local CLI version is allowed to differ because the hub/web logic — where soup layers actually live — runs centrally. |
| **D. Fork sync state as a precondition** | Low (`hapi-sync-fork-main` + push) | Low | Not parity by itself — just stops fork `main` from drifting further behind upstream. Currently `main` is ahead 823 / behind 17 vs `upstream/main`; the "behind 17" needs a sync run regardless of which option above is chosen. |

---

## 4. When matching is necessary vs overkill

- **Coding against an upstream PR worktree** (the normal `hapi-worktree-create` flow): base off `upstream/main` directly. No soup involvement at all — soup parity is irrelevant here by design (PR branches are meant to be clean/upstreamable).
- **Dogfooding `:3006`** as a user or tester: Option C. There is no reason to rebuild anything locally to *use* the dogfood instance — that's what the hub is for.
- **Running their own hub** (a genuinely separate operator estate, not just a client): only here does Option A start to make sense, and even then it means signing up for this doc's entire maintenance surface (mirror hygiene guard, tooling-commit hygiene, remat-hold escalation, atomic web swap, DB downgrade jiu-jitsu) — i.e., becoming a second soup kitchen, not "matching a version."

---

## 5. Estate snapshot (verified 2026-08-20, this session)

| Claim in remit | Verified value | Notes |
|---|---|---|
| driver soup tip `175105f0e` | **Confirmed** — `git -C driver log -1`: `175105f0ec3… merge(soup): driver/fleet-runner-upgrade — keep displayLinks + version commands`, 2026-08-18 18:40:25Z | Did not independently verify the `driver/fleet-runner-upgrade` branch tip `b3c21c9cc` claim — only the merge commit on `driver/integration`. |
| fork main tip `e398635bc` | **Confirmed** — `chore(tooling): drop ghost soup layers blocking remat resume`, 2026-08-18 18:39:52Z | |
| manifest 42 active layers | **Confirmed** — `grep -c '^\s*- (branch\|pr):' config/driver-manifest.yaml` → 42 | |
| web/dist on driver is stale (Aug 17) vs soup tip (Aug 18) | **Confirmed** — `driver/web/dist/index.html` mtime `2026-08-17 16:46:59Z`, soup tip merge commit is `2026-08-18 18:40:25Z` | So `:3006`'s served bundle predates the last soup merge by ~26h; a `--build-web` pass hasn't run against that tip yet. |
| kitchen mirror dirty, 3 tracked files | **Confirmed** — `docs/tooling/new-feature-intake.md`, `scripts/tooling/hapi-overseer-call.sh`, `scripts/tooling/hapi-overseer-watch-tick.sh` modified (plus 2 untracked files not counted in the "3 tracked" figure) | Pre-existing at session start — not touched by this task. |
| remat-hold off | **Confirmed** — `hapi-driver-status`: `remat-hold: idle (no escalation)` | |
| active symlink → `/work/coding/hapi/driver` | **Not confirmed as stated** — `hapi-driver-status` reports `active -> (no symlink)`; `hapi-active` did not resolve as a plain symlink in this session's view of the filesystem. Did not chase further (out of remit — no stack-switch/activation work authorized here). Flagging for operator awareness, not asserting it's wrong. | |
| — (not in remit, found incidentally) | `remat-lease: HELD by 05d9f0f2-9273-4137-933c-07459a1146a2` (the **parent/originator session**), heartbeat `2026-08-18T18:42:49Z`, `live=1` — **~1d 20h stale** relative to 2026-08-20 | Surfacing this back to the parent session directly; may be worth a manual `hapi-remat-hold` / lease check if it's blocking other remat work. |
| `cli/package.json` version `0.28.0` on both trees | **Confirmed** on fork main and driver | Reinforces §1 — identical semver, materially different trees. |
| fork sync state +823/-17 vs upstream | **Confirmed** — `git rev-list --left-right --count upstream/main...main` → `17\t823` (behind 17, ahead 823) | |

---

## 6. Friction mode

**Steelman: "workmate should just `npm install` latest"**

- Fast, zero tooling burden, standard distribution channel.
- Correct choice for anyone who wants to use or contribute to *vanilla* HAPI, or test against a real upstream release.
- **Kill criterion:** the moment the workmate needs *any* fork-only capability — Garden, session-jobs, github-pr-awareness, any of the 42 layers — this path cannot provide it. Those features are not in the npm-published tree by construction (soup-only, fork-private, or not-yet-upstreamed).

**Steelman: "must rebuild soup from manifest"**

- Only way to get literal code parity with what `:3006` runs, including every in-flight fork layer.
- Necessary if the workmate is going to reproduce a dogfood-observed bug or develop a soup-only feature themselves.
- **Kill criterion:** the maintenance surface is enormous and *shared-resource* in nature — flock/remat-hold coordination, fat-tip re-thinning, atomic web swap, DB schema step-migrations, mirror/tooling-commit hygiene gates, hot-file collision layers. A workmate who only wants to *use* HAPI is being asked to become a soup chef. Worse: a second, independently-run rebuild from the same manifest is not "the same soup" — it's a second kitchen. Layer branch tips move between rebuilds (tip-forward mode is explicitly non-deterministic run-to-run per `driver-soup.md`), so two machines rebuilding "the same recipe" only coincidentally match at the instant of rebuild and diverge immediately after. True continuous parity requires *sharing* the manifest, the lock, and the rebuild cadence — which in practice means sharing the one soup host, not cloning it.

**Net recommendation:** default to Option C (§3) — point the workmate at the shared hub. Reserve Option A (local rebuild) for the narrow case of someone who will be actively hacking on soup-only code and needs a build loop, and even then, prefer they work in a worktree off this estate's soup host rather than standing up an independent driver checkout.
