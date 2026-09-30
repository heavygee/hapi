# Stranger-install VM rehearsal (pet + fleet-binary)

**Date:** 2026-09-30  
**Session:** throwaway VMs 2095/2096 on janus  
**Parent:** Overseer stand-in remit — close the gap left by [`2026-09-03-soup-packaging-vm-rehearsal.md`](./2026-09-03-soup-packaging-vm-rehearsal.md) §8  
**Pinned SHAs:** pre-fix `a352a7804` · fixed `b20204325` (heavygee/hapi#183) · verify tooling `3178d6bae` (+ follow-ups on `feat/verify-hapi-install`)

**Verdict up front:**  
- **Negative control works:** on `a352a7804`, `install-hapi-systemd-units.sh --profile <x>` dies immediately with `ERROR: template not found: --profile` — assertions 2–7 unreachable; recorded as **could not proceed**.  
- **Fleet-binary on the fixed tip mostly works** through `/health` + live OOM + ExecStartPre binary; watchdog fires once `settings.json` exists. Wrapper is **default-on** again (`--no-systemctl-wrapper` to opt out) — rehearsal artefacts recorded the earlier opt-in-absent state.  
- **Pet one-liner on the fixed tip was broken for anyone without `/opt/hapi/hapi`:** global `HAPI_BIN` default `/opt/hapi/hapi` before the profile switch made `user-pet` units `ExecStart` a missing path (`status=203/EXEC`). Public curl|bash / companion path. Fixed on `feat/verify-hapi-install` (+ `install-hapi-pet.sh --hapi-bin` defence in depth). After rebinding `HAPI_BIN` to `~/.local/bin/hapi`, pet hub+runner came up and `/health` passed.

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
| No `/usr/local/sbin/systemctl` wrapper | PASS (absent; was opt-in at rehearsal tip) | PASS |
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
| Systemctl wrapper | PASS (absent; opt-in at that tip) | PASS (absent) |

**Root cause (pet):** `install-hapi-systemd-units.sh` set `HAPI_BIN="${HAPI_BIN:-/opt/hapi/hapi}"` **before** the profile `case`. The `user-pet` line `HAPI_BIN="${HAPI_BIN:-$INSTALL_DIR/hapi}"` never applied. Fix: empty global default; fleet-binary sets `/opt/hapi/hapi`; user-pet sets `$INSTALL_DIR/hapi`.

---

## 3. What the executable check must keep catching

1. Installer source-`$@` bug (neg SHA).  
2. ExecStartPre path that is not an executable **file** (delegated to `verify-hapi-systemd-units.sh`).  
3. Watchdog **ConditionPathExists from unit text** (delegated) + journal fire (ours); missing `settings.json` with parent home present is a NOTE on fresh box.  
4. Sudoers: **`/etc/sudoers.d/hapi-watchdog` primary** — grants runner User= or not; unreadable → inconclusive (not a false red).  
5. Systemctl wrapper **present by default** (`--no-systemctl-wrapper` / `HAPI_EXPECT_NO_SYSTEMCTL_WRAPPER=1` to opt out).  
6. `MainPID` ↔ `runner.state.json` pid — **three outcomes**: match → ok; readable mismatch → not ok (ninja class); unreadable/absent/no-pid after bounded retry → **inconclusive** (not FAIL).  
7. Live `/proc/<pid>/oom_score_adj`, not only unit properties.  
8. Standalone Tier-1 with empty `User=` demands `--watchdog-user` (systemd 252).

---

## 4. Follow-ups / coordination (Overseer 2026-09-30)

- **`HAPI_BIN` profile-default fix** + `install-hapi-pet.sh --hapi-bin` defence in depth on this PR.  
- Rebased onto #183 squash `8924ef04d`; fold not fork.  
- Verifier failure semantics fixed per #185 review (false red → inconclusive).

---

## 5. Artefacts

Under `docs/plans/artefacts/2026-09-30-stranger-install/` (tokens scrubbed):

- `*/neg/installer-smoke.txt`, `summary.txt`  
- `*/pos/systemctl-cat*.txt`, `verify*.txt`, `health.json`, `runner.state.json`, `watchdog-journal.txt`, `sudoers-*.txt`, …
