From: /sessions/a833f693-0b59-4913-b895-f010cbb311fa

# Peer: Cursor fleet authentication (estate-wide)

Operator voice request (notify session `3e291823-0972-4134-9bba-064266991c72`): we believed Cursor login was **harmonized across all servers**. It is **not** holding. Spawned you to own diagnosis, remediation, and a **repeatable** audit so we stop firefighting this every week.

## Parent / originator

- **Orchestrator:** [meta HAPI triage/problems](/sessions/a833f693-0b59-4913-b895-f010cbb311fa)
- **Trigger session:** [quest-audio-relay hapi-inline](/sessions/d214d32e-7f7c-438c-a8cc-8170988af7d0) replied `Upgrade your plan to continue` — operator account is **not** out of credits; this is **wrong Cursor API key / account skew** on Proxmox.

## Canon (read first)

| Doc | Path |
|-----|------|
| Fleet sync runbook | `~/coding/hapi/docs/tooling/cursor-auth-fleet-sync.md` |
| Aug-09 incident class | same doc § Incident notes |
| Hub on oos | `192.168.86.79:3006` |
| Machines | `oos-linux` (`5f5a87e8`), `proxmox` (`f9bb3c9e`), `Teemo` (Windows — audit TBD) |

## Intended state (source of truth)

1. **Canonical account:** `~/.config/cursor/auth.json` on **oos-linux** after good `agent login`.
2. **Derived envs** on every runner host must match that `apiKey` (sha12 only in logs — never print keys):
   - `~/.hapi/cursor.env`
   - `~/.config/cursor/api-key.env` (Proxmox systemd `EnvironmentFile`)
   - `~/.config/hapi-oos-agent.env` (oos runner)
3. **`pin-cursor-auth.sh`** on runner **ExecStartPre**: rewrite `auth.json` toward `cursor.env` if drifted. Must **not** leave `chattr +i` on `auth.json`.
4. **Runner restart** after sync — long-lived HAPI wrappers keep stale creds until killed/resumed.

## Fleet audit snapshot (2026-08-22 ~15:50 UTC — Meta gathered)

### oos-linux — **GOOD**

| Check | Value |
|-------|-------|
| `auth.json` sha12 | `ce10f07200bd` |
| `.hapi/cursor.env` | MATCH |
| `hapi-oos-agent.env` | MATCH |
| `api-key.env` | missing (oos uses other drop-ins — OK) |
| Runner | `hapi-runner-oos.service` **active** |
| Pin script | present |
| `.cursor` | → `/var/lib/hapi/cold/cursor` (205G free on cold disk after operator cleanup) |

### proxmox — **BROKEN (split brain)**

| Check | Value |
|-------|-------|
| `auth.json` sha12 | `e196a407523f` (**wrong account**) — mtime **today** (agent token refresh rewrote it) |
| `.hapi/cursor.env` sha12 | `ce10f07200bd` (**oos canonical**) — **DIFFERENT from auth.json** |
| `api-key.env` sha12 | `e196a407523f` — MATCHes bad auth.json |
| Runner | `hapi-runner.service` **active**, drop-ins include `20-cursor-api-key.conf` + `25-pin-cursor-auth.conf` |
| Live wrappers | **22** long-lived `hapi cursor` processes — many never picked up a pin cycle |
| Symptom | `Upgrade your plan to continue`, `Authentication required` |

**Root cause class:** Same as 2026-08-09 incident — live ACP refresh flips `auth.json` to a depleted/secondary account (`e196a407523f` = lockhouse-class key) while `cursor.env` still holds oos key. Pin script fixes `auth.json` from `cursor.env` on **runner start only**; it does **not** rewrite `api-key.env`. Runner loads `api-key.env` → spawns sessions with bad key. Sync from oos was done Aug 9 but **re-drifted**.

### Teemo — **UNKNOWN**

Hub machine row exists; no SSH audit this turn. Windows path likely differs — document and probe if operator cares.

## Why NOT universally fucked

| Factor | Effect |
|--------|--------|
| Host | oos sessions use good key; proxmox sessions use bad key |
| Process age | Aug-12 wrappers on proxmox never restarted after sync |
| Failure mode | Per-turn model billing — idle looks fine until user sends message |
| Other errors | ENOSPC / 143 / disk full are **different** killers (oos cold disk Aug 19) |
| `Upgrade your plan` | Almost always **account skew**, not operator usage limits |

## Your assignment

### Phase 1 — Remediate (operator wants this fixed, not just documented)

1. Re-run **Sync procedure** from `cursor-auth-fleet-sync.md` (oos → proxmox). Verify all three env files + `auth.json` share sha12 `ce10f07200bd`.
2. **Restart proxmox runner** (TTY override per runbook). Confirm runner process `CURSOR_API_KEY` matches auth.
3. **Smoke:** `agent -p` on proxmox; true-resume [quest-audio-relay hapi-inline](/sessions/d214d32e-7f7c-438c-a8cc-8170988af7d0) OR confirm operator wants migration to oos instead.
4. List proxmox live wrappers still on bad account — recommend kill+resume batch **only** after sync verified.

### Phase 2 — Make it stick (why we keep redoing this)

1. **Audit script** (e.g. `scripts/tooling/hapi-cursor-auth-audit.sh`): SSH or local checks for every fleet host; exit non-zero on drift; print sha12 + MATCH/DIFFERENT table only.
2. **Harden pin script** (fork operator tooling): when pinning, also rewrite `api-key.env` from `cursor.env` so systemd and auth.json cannot diverge.
3. **Optional:** systemd timer / Meta chip for daily audit; file issue if product should persist `lastModelError` with account hint.
4. **Teemo:** add to audit matrix when reachable.

### Phase 3 — Report

Deliverable: short estate table (host × sha12 × runner × smoke × broken sessions). Update `cursor-auth-fleet-sync.md` only if runbook gap found.

## Do NOT

- Restart `hapi-hub.service` (yanks live agents).
- `chattr +i` on `auth.json` for steady-state.
- Print `crsr_` keys in chat or commits.
- Merge on `tiann/hapi` from agent shell.

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer a833f693` — open with `From: /sessions/<your-id>` + `Name: <your metadata.name>`.
2. Verdict: fixed / partial / blocked + what remains.
3. `AGENT_NOTIFY_SUMMARY` on final turn.
