# A2A nametag-only (one-page thesis)

**Date:** 2026-08-17  
**Status:** Regroup after #1473 overweight  
**Replaces promise of:** fortress same-UID provenance / memory-only runner proof / resume fail-closed theater  
**Keeps / targets:** simple reply attribution for well-behaved agents

---

## One sentence

When agent A talks to agent B, B (and the human) should see a light **nametag** - who sent this - so B knows who to answer, **without** loading a security essay into MCP context and **without** breaking reboot or normal `hapi resume`.

---

## What we wanted all along

- Good actors, multi-agent kitchen.
- Clear “this is me; talk back to me.”
- Human-visible chip / link in chat when useful.
- Almost **zero** standing context tax (no MCP provenance dump, no identity sermon in every session).

## What #1473 became (rejected direction)

- Adversarial same-UID sibling threat model (Codex mole).
- Memory-only machine secrets, cold-restart stranding, terminal resume fail-closed.
- Millions of tokens of bot↔bot churn.
- Product disruption far beyond “nametag for replies.”

**Decision:** close upstream #1473 as overweight. Regroup on nametag-only ([#1618](https://github.com/tiann/hapi/pull/1618)). Residual recovery ideas (if ever needed) stay optional later (#1486) - not blocking A2A hello.

**Operator canon (2026-08-22):** `docs/operator/AGENTS.md` § Peer message identity updated — agents must **not** describe nametags as verified/trusted/capability-bound.

---

## Non-negotiable constraints

1. **Light touch** - no massive MCP / tool-context injection for this ability. Ever.
2. **No reboot ritual** as the price of saying hello.
3. **No intentional breakage** of terminal ↔ web handoff for ordinary operators.
4. Prefer **hub-stamped sender id** on the delivery over client-invented cryptography theater.
5. Slash text from peers must not run as receiver controls (keep that foot-gun closed if already fixed elsewhere; do not expand scope).

---

## Success = nametag

| In | Out of scope |
|----|----------------|
| Trusted sender session id on peer deliveries | Same-UID malicious forge resistance as ship gate |
| UI chip / `@Name` / `/sessions/<id>` where upstream already has mention UX | Disk or memory “machine proof” redesign |
| Reply routing back to that session | Cold-restart remap product (#1486 later, optional) |
| Tiny docs / errors if anything fails | MCP context bloat, AGENTS provenance walls |

---

## Implementation stance (for the feature peer)

- Branch from **upstream/main** (clean), not the #1473 fortress branch.
- Reuse existing upstream surfaces: `ping_peer` / peer delivery path, composer session mentions (`composerSegments`), session path chips - extend attribution, do not invent a parallel identity stack.
- Measure context: if the feature needs more than a short wire field + existing chip render, stop and ask.
- Dogfood later by swapping soup off the #1473 monstrosity onto this svelte path - **after** the thin PR exists and passes gates.

---

## Closing statement for #1473

After extensive review churn, we are not shipping fortress provenance as the A2A answer. We are regrouping on **simple attribution for replies** only.
