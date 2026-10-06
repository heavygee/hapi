# Task brief: complete removal of the rejected #1473 fortress stack from the soup

**Raised by:** Overseer stand-in, at operator direction (2026-08-27).
**Owner:** tooling meta-bot (soup/remat lane). The stand-in has no authority to perform any of this.
**Operator position:** complete the removal estate-wide; a restart is acceptable if required,
though ideally avoided.

## Why

Upstream #1473 (capability / session-proof HMAC) was **closed without merge as overweight**. The
regroup is nametag-only — see [`../plans/2026-08-17-a2a-nametag-only-thesis.md`](../plans/2026-08-17-a2a-nametag-only-thesis.md).
Operator canon was updated 2026-08-22 (`f09bfb225`): peer nametags are **UX routing hints** under
namespace-token trust, explicitly **not** verified and **not** capability-bound.

`upstream/main` is verified clean of `hub/src/web/peerCapability.ts`. **The running soup is not.**
Because the capability is HMAC-bound to the session id, and `sync/sessionCache.ts` rotates ids by
merging onto a new row and deleting the old *without re-issuing a capability*, **any session whose
id has rotated is permanently locked out of attributed peer messaging** — a silent 403. One peer
sat mute for 7 days believing its own reports had failed; this stand-in's attributed sends fail the
same way right now.

PR #1618 is the proper replacement but is Lane-A blocked on @tiann. So this is **soup hygiene in
the interim, not a code fix.**

## Verified scope

Enumerated across every active manifest layer — **please re-verify before acting.**

- Manifest `base: upstream/main` — **clean**. The base is fine.
- **44 active layers: 37 clean, 7 carry `hub/src/web/peerCapability.ts`:**

| Layer |
|-------|
| `driver/cursor-notify-rule-delta` |
| `driver/kitchen-status-session-list` |
| `driver/hapi-inline-operator-dock` |
| `driver/doctor-provenance` |
| `driver/invalid-argument-bridge-gate` |
| `driver/fleet-runner-upgrade` |
| `driver/overseer-brain-active` |

- `feat/a2a-p05-peer-provenance` is **already commented out**. That drop was correct but
  **ineffective** — these 7 fat tips re-import the same stack on every rebuild. Dropping a layer
  does not remove code other layers happen to re-carry.
- `driver/integration` and `driver/integration-wip` also carry it; they are the merge *product*,
  not inputs.

## The ask

**Re-cut those 7 layers thin** from clean `upstream/main` — feature-only, without the fortress
stack — rather than dropping them. Dropping wholesale would cost seven live features, including
the overseer brain (`driver/overseer-brain-active`), the operator dock, the invalid-argument
bridge gate, and kitchen-status which only just landed.

If any layer cannot be thinned quickly, **say which and what it costs** so the operator can choose,
rather than silently dropping it.

## Proof required (not "done")

After rematerialisation:

1. `git show driver/integration:hub/src/web/peerCapability.ts` should **fail** — file absent.
2. An attributed `ping_peer` from a session whose id has rotated should **succeed**.

Please post that evidence.

## Discipline

- Run the driver-status precheck before any rebuild (exit 0 idle / 75 busy / 2 stale).
- Use the standard rebuild-with-web-and-verify path, then the web-dist verification step.
- Restart **only** via the patient-drain restart helper. Do **not** use a direct `systemctl`
  restart of the hub service — it yanks live agents mid-turn, and the estate is busy.
- Blast radius is wide and many sessions are mid-flight. Prefer a window; ask the operator to pick
  one if you want cover.

## Related

- Upstream issue #1698 — reframed twice; likely a close-in-favour-of-#1618 rather than a fix.
- Stale docs still teaching the rejected model, not yet corrected:
  `docs/tooling/machine-reenroll-resume-runbook.md` (whole-doc rewrite),
  `docs/plans/2026-08-13-session-mailbox-fleet-comms.md`.
