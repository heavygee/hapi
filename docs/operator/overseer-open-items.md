# Overseer: open items on the operator

Maintained by the Overseer stand-in session. Every row is something waiting on
**Gavin specifically** — a decision, an action only he can take, or an approval.
Items move out when they are done, not when they are discussed.

Last swept: 2026-11-09.

---

## 1. Blocking today

| Item | State | What is needed |
|---|---|---|
| **`gc-in-linux` bring-up** | VM 101 up **3d 11h**, untouched: no repo, no ansible, no Tailscale, no HAPI | 1Password vault `gc-in-linux` (App key from `lockhouse-agent-gc` 95812/583142, read token, Tailscale key tagged `tag:in` only), then the attended converge. Runbook written. No agent can do this: no tty, and the sudo password is deliberately not shared. |
| **`server-setup` org migration** | Phase 1 done, runners proven taking real jobs | Confirm no fine-grained PAT scoped to the repo, then say go. **Rollback expires with the org on 19 Nov** — after that there is nowhere to transfer back to. |
| **`infra#501` Arthur CE converge** | 12 of 63 checks failing; decision block prepared | Four answers in one sitting: non-root operator account; Ubuntu-declare-origins vs Debian rebuild; a reboot window (34 days pending against a 10-day deadline); go-ahead for one attended `--tags apply`. Yes to all four converges to 1–2 documented exceptions. |

## 2. Upstream PRs — his lane, agents prepare only

| PR | State | Note |
|---|---|---|
| ~~`tiann/hapi#1598` content search~~ | **MERGED 2026-11-02**, commit `82c5c00a3` | Done. techotaku39's PR, landed a week before this list was written — my earlier "still DIRTY, needs rebase" was wrong. The community promise is kept. |
| `tiann/hapi#2251` A2A consolidated | Hardening dogfooded; **substring delta queued, needs his go** | Label is honest for the hardening only until the resolve change gets its own fleet window. |
| `tiann/hapi#2164` display-prompt | **Rebased, CLEAN, 4/4 green** | Four captured flavour strings survived the rebase. Ready. |
| `tiann/hapi#2326` prompt shrink | **CLEAN, 5/5 green**, live-proved | Lane-B shaped. Ready. |
| `tiann/hapi#2147` Boards | **CLEAN, mergeable** (rebased 2026-11-09) | The meta watcher loop caught upstream movement and rebased it. Ready. |
| MCP `_meta` alwaysLoad | Prepared, **not opened** | Which tools stay resident is a product judgement, held for him. |

## 3. Decisions outstanding

- **Durable `agentSessionId` resolve: restore, or stop advertising it.** Stripped from the composed tip on 5 Nov by a verify cleanup. Four sessions have now routed around it. The tool descriptions every agent reads advertise it. "Documented and broken" is the worst option.
- **Contrastive-framing compression, §4.A only** — the settled duplication cuts (~353 tok/turn on Cursor, ~0 on Claude). Content cuts held, scar clauses kept.
- **`IT-Systems#389` (`tag:gc-vm`)** — CI red on a real isolation failure (`tag:gc-vm:22` want Drop, got Accept). Underlying question: broad-identity grant style, or the narrower `is-vm` shape. Not urgent — `gc-in-linux` was decoupled onto `tag:in`.
- **`infra#497`** — retire or keep `dl-vm-a1` (Doug's deallocated Azure VM, retired build standard). Recommendation: retire.
- **`infra#567`** — Doug's session tools (`hapi-spawn`, `hapi-set-title`, `hapi-archive`, `hapi-pin`) **confirmed broken** on `dl-in-linux` and probably always were. Decision: tell him now, or when it is fixed.
- **CTO title in `risk-register.md`** — names Ian three times; misled three sessions into building Gavin's box as Ian's.
- **Guard false positives** — three read-only diagnostics refused in one evening, the third being the guard blocking its own incident report. Reproducible defect, filed.
- **Context mode on the hub** — live on proxmox, absent on oos-linux. Finish the rollout or retire the monitoring.

## 4. Arthur — progress wanted for Monday

- The **plan-of-attack document** could not be found in the repo. Needed: repo + path, or the session holding it.
- **Documentation sweep and gap delta** against the documenting framework. Note `docs/process/epic-shaping-and-delivery/` carries a banner reading *"proposal under assessment, not adopted"*, decided 10 Sept in favour of the feedback ledger.
- **`arthur#175`** — the sandbox-supersession review — was closed on 10 Sept, the same day a batch of six stale PRs was cleared out without review. The work it describes has probably never been done.
- **TRL assessment per Arthur module**, for the modules begun under the scout work.

## 5. Smaller, still his

- **`heavygee/putout#156`** (Norway adapter) — red secret scan, undiagnosed. Not merged past it.
- **`heavygee/handovr`** — private, clean, CI green. Flip to public when he has looked at it. Mod namespace still `ConchProbe`; rename wants a Bigscreen-capable machine.
- **Chickens bedtime** — open the front door for ten seconds so the live sensor transition can be observed; the Kinrupt voice decision; coop-latch sensor vs front door.
- **Montrose Minecraft** — chat policy decision. Server built, restore drill passed, delivered to the kids.
- **Strunk & White `AGENTS.md`** — stripped version delivered inline, awaiting his review.
- **Three proxmox sessions** with real transcripts that cannot be resumed — leave, or attempt recovery. Recommendation: leave.
- **Teemo** — orphaned wake-word files and model data, untracked, no longer wired to anything.
- **`infra#511`** — nothing audits Claude Code login currency on any box in the fleet.
- **`infra#512`** — plaintext sudo password on `dl-in-linux`, assessor-visible during a live CE assessment.
- **Sparling board-trigger gates** — parked by him; the label-fired agent still has no assignee or open-PR guard.
