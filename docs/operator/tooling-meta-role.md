# tooling/meta bot — standing authority and practice

**Audience:** whoever currently holds the tooling/meta seat. **This role is swapped periodically** (Cursor → Claude on 2026-11-08; expect more). The seat's knowledge must live here, not in a session.

Everything below is either **POLICY** (operator-stated, binding) or **PRACTICE** (what the previous holder actually did, recorded because docs describe prohibitions and practice describes behaviour — the gap between them is where a swap silently loses capability).

Sourced from the 2026-11-09 handover conversation with the outgoing Cursor holder (`028d0a86`), who is retained as `consult_on_surprise` in `config/meta-sessions.yaml`. **Wake it rather than guess.**

---

## 1. Restart cadence

**POLICY (operator, 2026-11-09):** keeping the soup fresh and the system current is this seat's responsibility. You do **not** need permission to restart. `hapi-restart-hub` is graceful by design — *the patient drain is the quiet period*. Asking for a restart blessing is the error.

**PRACTICE (previous holder):**

- Restart after **any** green remat that touched hub or CLI. Not after every promote — a `web/dist`-only change sometimes needed only smokes.
- Long remats run inside `hapi job run … hapi-driver-rebuild --build-web --verify`. The post-remat step **inside** the job prints `refusing in-tree hapi-restart-hub`; run `hapi-restart-hub` **after the job exits**.
- **Hold** only for: fleet-seal / governance GO, anything smelling of stack-switch (`hapi-use-*`), and `--impatient` reserved for a wedged hub.

**Anti-pattern, observed:** the incoming Claude holder read `CLAUDE.md`'s *"NEVER `sudo systemctl restart hapi-hub.service` — use `hapi-restart-hub`"* as "restarts need escalation", and left a composed tip unpublished for hours. The prohibition is about the **raw** call; the wrapper is the sanctioned path and it is yours.

### Managing a drain you no longer want

**PRACTICE (predecessor) + hard-won 2026-11-09.** A patient drain waits **forever** by design. That is correct behaviour, and it means a drain you no longer want does not go away on its own.

| Situation | Do this |
|---|---|
| Drain is waiting on genuinely busy sessions | **Wait.** That is the feature. |
| Hub is wedged and you need it now | `--impatient` / `HAPI_IMPATIENT=1` — TTY-gated, operator-shaped urgency only |
| Drain is superseded (stack already restarted, or you started a duplicate) | **`hapi-restart-hub --cancel`** |
| Any of the above | **NEVER `kill` / `pkill` the wrapper** |

**Why `pkill` is forbidden and not merely blocked.** The production-mutation guard refuses it, correctly — it cannot tell a restart wrapper from the hub. But the deeper reason is that half-killing a drain **defeats the lock that stops drains stacking**:

`hapi-restart-hub` takes `driver_status_acquire switch` *before* draining, so a second invocation should exit 75. The line above it heals "stale" state, where stale meant *recorded pid dead AND flock free*. `pkill` of the recorded wrapper makes both true — the lock fd dies with the parent — while live waiters keep draining. Status then reads stale while a real drain runs, autoclear heals the lie, and the next caller acquires cleanly and **queues a second drain behind the first**. Three accumulated this way on 2026-11-09; both then fire whenever sessions next go quiet.

Three fixes closed it, and the ordering matters if you are reading the code:

- `d138ad5a9` — `--cancel`, the control plane that did not exist (SIGTERM only, narrowed to this script's own pids, never the test harness, no SIGKILL escalation)
- `4ead05223` — startup refusal when a drain is already live; stops **you** stacking
- `784a0d7db` — `driver_stack_autoclear_stale` now checks process reality for `switch`, not just the recorded pid; stops the **next agent** stacking after someone else's half-kill. The genuine `kill -9` leftover case still heals — that is asserted first in its test so the fix cannot degrade into "refuse always".

**The generalisable bit:** dead recorded pid + free lockfile is *necessary but not sufficient* evidence that nothing is running. Check process reality before healing any lock.

## 2. Standing authority — what to just do

| Action | Authority | Note |
|---|---|---|
| Promote tip / remat as owner | **Just do it** | `HAPI_REMAT_OWNER=1` + token |
| Clear a remat hold **you own** | **Just do it** | success auto-clears it anyway |
| `hapi-restart-hub` after a green hub/CLI remat | **Just do it** | § 1 |
| Push fork `main` unannounced | **Just do it** | kitchen hygiene, not ceremony — and remat refuses an unpushed tip |
| `hapi-restart-hub --cancel` a superseded drain | **Just do it** | see § Managing a drain above; never `pkill` |
| Reset dirty worktrees | **Carefully** | never a blind stash of someone else's dirt; prove the index tree matches an existing commit first, and check no active session has it as cwd |
| Retitle a superseded session `SUPERSEDED …` | **Just do it** | |
| **Hard-archive another session** | **NOT this seat's call** | operator/outside only |
| Stack-switch from an agent shell (`hapi-use-*`) | **Never** | rebuild/remat yes, switch no |

**POLICY:** "the operator must bless every remat/restart" is **not** standing law. Remat-owner token plus the wave-unlock text **is** the blessing.

**The archive line, exactly (predecessor, verbatim intent):** hard-archiving peer kitchen/specialist sessions is not unilateral. The one permitted case is a **throwaway you spawned yourself** whose remit already said to expect archive — that is cleaning up your own mess, not deciding someone else's fate. An operator-explicit archive stands. **Do not invent a third category.**

## 3. Wave-clear unlock — the order

The PR watcher may send an unlock ping; execution is this seat's. The previous holder never ran a live one (its remats were hold/attribution/fleet-seal driven), but this is the order it would follow, matching what `_do_wave_unlock_ping` ships:

1. `hapi-driver-status --quiet` — `0` go, `75` wait (**do not double-remat**), `2` stale, `76` remat-hold.
2. `hapi-sync-fork-main && git push origin main` if fork main is behind upstream.
3. `HAPI_REMAT_OWNER=1` (+ token, `HAPI_REMAT_RESUME=1` when continuing a held WIP) `hapi-driver-rebuild --build-web --verify` — prefer `hapi job run` for long ones.
4. After the job exits: `hapi-verify-web-dist`, then `hapi-restart-hub` if hub/CLI changed.
5. Archive idle 🔧 peers **from outside** once the soup is fresh — never a mid-turn self-archive.

There is no secret ritual beyond this checklist.

## 4. Other routines of the seat

- **Same-turn commit of utensil dirt** on the mirror before stopping (tooling-commit ledger / stop hook). Do not leave `scripts/tooling/` or `docs/` edits uncommitted across a turn.
- **Long remats in `hapi job run --wake-on-terminal`** so the session meter survives the rebuild. Background shells lose exit-code fidelity — that is how tip and smoke stories get lied about. (Learned the hard way: a rebuild piped through `tail` reported exit 0 twice while the log said `ERROR`.)
- **Fleet-seal / NOTES proof** follows governance, not every remat.
- **Ping-peer attribution hygiene** — soft nametag, no crypto. See `AGENTS.md` § Void chips.
- **Flavour-swap orchestration** (spawn successors, flip env/registry pointers, SUPERSEDE husks) is one-shot work, not a recurring duty.

## 5. Flavour couplings — check these on every swap

A swap can silently remove an ability, and **the symptom reads as "this action needs permission" rather than "the tool cannot see me".**

**Audit on arrival:**

```bash
grep -rln "CURSOR_AGENT\|CURSOR_INVOKED_AS" scripts/
```

Known state after the 2026-11-09 sweep:

| File | Verdict |
|---|---|
| `hapi-restart-hub.sh` | **was Cursor-only** — drain self-exemption hung a Claude caller forever (`9b855dd3f`, `8e87a2143`) |
| `lib/patient-drain.sh` | **was Cursor-only**, no consumer — fixed before adoption could reintroduce it (`8e339eb83`) |
| `gh-wrapper.sh` | flavour-agnostic (`CLAUDECODE`, `HAPI_AGENT_CONTEXT`, CI, no-tty fallback) |
| `hapi-laneb-authorise.sh` | flavour-agnostic |
| `context-mode-cull-spinners.sh` | legitimately Cursor-specific (reads Cursor session ids) |

**Guards are NOT Cursor-only.** Claude gets the same preToolUse set via `hapi-claude-pretooluse-guard.sh` → `.claude/settings.json` (`generateHookSettingsFile` in `runClaude.ts`); Cursor uses `.cursor/hooks.json`. The `systemctl` wrapper and sudoers layers are agent-agnostic. If a guard refuses you, **reshape, never bypass**, and report the refusal.

**Cursor-shaped footguns that persist:** `change_title` identity slips (a holder reclaimed the live kitchen title mid-swap), and hand-written `From:` lines carrying an agent-runtime id instead of the hub id — four sessions got that wrong in one night.

## 6. On arrival, do this

1. Read this file and `AGENTS.md` § *After a flavour swap*.
2. Confirm pointers name you: `config/remat-escalate.yaml`, `~/.hapi/meta-daily.env`, `config/meta-sessions.yaml`. Verify with `scripts/tooling/hapi-meta-sessions-audit.sh`.
3. Confirm you can read `~/.config/hapi/remat-owner.token`.
4. Run the flavour-coupling audit in § 5.
5. `ping_peer … wake=true` the `consult_on_surprise` session the first time anything feels gated.
