# Stranger-install VM rehearsal (pet + fleet-binary)

**Date:** 2026-09-30  
**Session:** throwaway VMs 2095/2096 on janus  
**Parent:** Overseer stand-in remit — close the gap left by [`2026-09-03-soup-packaging-vm-rehearsal.md`](./2026-09-03-soup-packaging-vm-rehearsal.md) §8  
**Pinned SHAs:** pre-fix `a352a7804` · fixed `b20204325` (heavygee/hapi#183) · verify tooling `3178d6bae` (+ follow-ups on `feat/verify-hapi-install`)

**Verdict up front:**  
- **Negative control works:** on `a352a7804`, `install-hapi-systemd-units.sh --profile <x>` dies immediately with `ERROR: template not found: --profile` — assertions 2–7 unreachable; recorded as **could not proceed**.  
- **Fleet-binary on the fixed tip mostly works** through `/health` + live OOM + ExecStartPre binary + no surprise systemctl wrapper; watchdog fires once `settings.json` exists.  
- **Pet one-liner on the fixed tip was broken by a real remaining bug:** global `HAPI_BIN` default `/opt/hapi/hapi` before the profile switch made `user-pet` units `ExecStart` a missing path (`status=203/EXEC`). Fixed in this wave on `feat/verify-hapi-install`. After rebinding `HAPI_BIN` to `~/.local/bin/hapi`, pet hub+runner came up and `/health` passed.

Executable deliverable: `scripts/tooling/verify-hapi-install.sh` (+ `.test.sh`), extending `verify-hapi-systemd-units.sh`. Artefacts: `docs/plans/artefacts/2026-09-30-stranger-install/{pet,fleet}/`.

---

## 1. Matrix

| VM | Profile | Spec | IP |
|---|---|---|---|
| 2095 `oos-stranger-pet-test` | `user-pet` / `install-hapi-pet.sh --with-systemd` | 2 vCPU / 4 GiB / 20 GiB | 192.168.86.196 |
| 2096 `oos-stranger-fleet-test` | `fleet-binary` | same | 192.168.86.197 |

Janus `MemAvailable` ~17 GiB before create (Phase 0). Destroyed after artefact capture.

**Explicit gap (stated, not implied):** no agent CLI / Claude auth. This proves supervision + hub HTTP, **not** the ninja “sessions cascade on restart” class.

---

## 2. Assertion results

### Neg (`a352a7804`) — both profiles

| Assertion | Result |
|---|---|
| Installer `--profile` reaches validation | **FAIL as required** — `template not found: --profile` |
| 2–7 | **Unreachable** — `NEG_RESULT=could_not_proceed` |

Positive control for the probe: `scripts/tooling/verify-hapi-install.test.sh` — 5/5 pass (fixed smoke passes; pre-fix archive fails).

### Pos — fleet-binary (`b20204325` + verify tip)

| Assertion | First verify | After hub wrote `settings.json` + re-kick |
|---|---|---|
| Installer runs | PASS (`INSTALL_RC=0`) | — |
| ExecStartPre runner-stop binary exists | PASS (`/opt/hapi/hapi`) | PASS |
| Watchdog actually executed | FAIL — `ConditionPathExists` skipped (no `settings.json` yet) | **PASS** — journal: machine present, no action |
| Sudoers applies to real account | FAIL — `sudo -l -U hapi` needs password for probe user | **File OK** — `hapi ALL=(root) NOPASSWD: … restart hapi-runner…` (verify now accepts readable sudoers.d) |
| No `/usr/local/sbin/systemctl` wrapper | PASS | PASS |
| Unit active + MainPID ↔ `runner.state.json` | active PASS; MainPID match FAIL (state unreadable / race on restart) | state pid 16445 matches when readable |
| Live `oom_score_adj` | PASS (runner 0, hub -1000) | PASS |
| Hub `/health` | PASS | PASS |

### Pos — user-pet (first install vs rebind)

| Assertion | First (`install-hapi-pet --with-systemd`) | After `HAPI_BIN=$HOME/.local/bin/hapi` rebind |
|---|---|---|
| Units point at real binary | **FAIL** — `ExecStart=/opt/hapi/hapi` → `203/EXEC` | PASS — `~/.local/bin/hapi` |
| ExecStartPre binary exists | FAIL | PASS |
| Unit active + `/health` | FAIL | PASS |
| MainPID ↔ state | n/a | intermittent fail under verify’s own restart (unsupervised class — keep asserting) |
| Systemctl wrapper | PASS (absent) | PASS |

**Root cause (pet):** `install-hapi-systemd-units.sh` set `HAPI_BIN="${HAPI_BIN:-/opt/hapi/hapi}"` **before** the profile `case`. The `user-pet` line `HAPI_BIN="${HAPI_BIN:-$INSTALL_DIR/hapi}"` never applied. Fix: empty global default; fleet-binary sets `/opt/hapi/hapi`; user-pet sets `$INSTALL_DIR/hapi`.

---

## 3. What the executable check must keep catching

1. Installer source-`$@` bug (neg SHA).  
2. ExecStartPre path that is not an executable **file**.  
3. Watchdog **journal / ConditionResult**, never `list-timers` alone.  
4. Sudoers grants the **runner User=**, not a hardcoded operator account.  
5. Opt-in-only systemctl wrapper.  
6. `MainPID` == `runner.state.json` pid after restart (ninja’s unsupervised runner).  
7. Live `/proc/<pid>/oom_score_adj`, not only unit properties.

---

## 4. Follow-ups

- Land `feat/verify-hapi-install` (verify script + `HAPI_BIN` profile-default fix) onto main / into #183 if still open.  
- `install-hapi-pet.sh` should pass `--hapi-bin` explicitly when invoking the companion installer (defence in depth).  
- Watchdog: first timer fire before `settings.json` exists is expected on a fresh box — document “kick after first hub start” or soften Condition to after hub unit.  
- Verify: read `runner.state.json` via `sudo -n` when not readable (fleet).

---

## 5. Artefacts

Under `docs/plans/artefacts/2026-09-30-stranger-install/` (tokens scrubbed):

- `*/neg/installer-smoke.txt`, `summary.txt`  
- `*/pos/systemctl-cat*.txt`, `verify*.txt`, `health.json`, `runner.state.json`, `watchdog-journal.txt`, `sudoers-*.txt`, …
