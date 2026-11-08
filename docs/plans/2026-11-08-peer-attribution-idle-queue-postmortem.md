# Postmortem: peer attribution vs idle-queue hypothesis (2026-11-08)

## TL;DR

- **Symptom:** Meta (`c88d8c52` / prior `a57d9d4a`) received `mcp__hapi__ping_peer` remits with no `From:`/`Name:` and acted on them.
- **Sender (`fa6fa99e`) correlation:** `Delivered to` (steered) ↔ attributed; `Accepted … idle` (queued) ↔ unattributed. Complete partition on their receipt log.
- **Hub forensics on the cited `localId`s:** every `ping-peer-*` row on the recipient is `meta.sentFrom: "webapp"` with **no** `meta.peer`. Queue and steer look identical in storage. Harness `annotatePeerDeliveryForAgent` would stamp **neither**.
- **Actual defect:** tip-forward absorb left `authenticatedSourceSessionId` dead; MCP still called `ping_peer` but CLI POSTed `/api/.../messages` as webapp. Fixed in `163dfbc55`, live tip `c5a182a12` after remat + hub/runner restart.
- **Queue hypothesis:** reopened with sender evidence; **refuted as the envelope-loss mechanism** for these rows. Receipt mode and attribution meta are orthogonal here.

## Timeline (compact)

1. Operator reports unattributed remits; hypothesizes queued vs steered.
2. Operator retracts after pinging idle `517743d6` and seeing attributed *reply* (wrong channel direction).
3. Meta remats `163dfbc55` (peer-messages restore + Codex annotate); typecheck flake fixed `c5a182a12`; tip green; hub restarted.
4. Operator reinstates queue hypothesis with `fa6fa99e` send log partition + exact `localId`s.
5. Hub DB decode of those `localId`s: all `webapp`, no peer meta; body `From:` only when relaying `517743d6`, never fa6fa99e harness envelope.

## Mechanism (evidence, not guess)

| Layer | Finding |
| --- | --- |
| Tool | `mcp__hapi__ping_peer` only; `deliveryMode` unset → `auto` |
| Pre-fix send path | POST `/api/sessions/:target/messages` with web JWT, **no** peer header → `sentFrom: webapp` |
| Intended path | POST `/cli/sessions/:source/peer-messages` → `sentFrom: peer` + `peer.sourceSessionId` → receiver prefixes `From:` / `Name:` |
| Steer vs queue | Same `sendMessage` POST first; steer is a second `/steer` call. Does not rewrite `sentFrom`. |
| Cited idle rows | `ping-peer-c77df8bd-…`, `ping-peer-66ad021e-…` — both `webapp`/`queue` in content meta |
| Neighbor "Delivered" rows | Same session, also `webapp`/`queue` in stored content meta |

So: **idle-queue did not uniquely strip an envelope that steer kept.** There was no hub peer envelope on either branch.

Why the sender partition felt causal: `auto` really does return different receipts (`Delivered to` vs `Accepted … idle`). That tracks target busy/idle. Attribution tracked the broken webapp path for *all* sends; perceived "attributed when steered" needs a separate explanation (relayed `From:` lines, other peers, UI/chip confusion, or body-typed nametags) — not differential meta on these rows.

## Detectability (receiver)

- **Harness stamp** only runs when `meta.sentFrom === 'peer'`. Webapp turns look like operator chat: **no mechanical "missing sender" flag.**
- Vigilance is not a safeguard (operator is right).
- After `163dfbc55`: authenticated MCP/CLI should stamp both queue and steer equally (shared POST). Absence of `From:` again means regression or bare non-session CLI (`From: peer (unattributed)` when peer header used without source id).
- Soft `From:` in prose remains forgeable; not a crypto proof. Industry pattern (OpenClaw inter-session wrap, AITP/Kurahi signing) is harness-asserted envelope before the model sees text.

## Upstream / giant A2A PR implications

- **Do not ship** A2A tooling upstream if tip-forward / soup absorb can silently demote peer POST → webapp. That is a kitchen-skunk: demos look fine while dogfood Meta merges on ghost remitters.
- **Contract to freeze for upstream:** MCP `ping_peer` with session identity **must** hit `/cli/.../peer-messages` (or equivalent hub-stamped peer ingest). JWT `/messages` without peer marker is operator voice, not agent voice.
- **Delivery mode is urgency, not provenance** (same split as Copilot SDK `source` vs enqueue/immediate). Upstream docs/PR description should say that out loud so the idle-queue myth does not become API folklore.
- **Receiver refuse policy** cannot be "require `From:` on every user turn" (blocks operator). Need either always-on peer meta for peer ingress, or a dedicated role/prefix the harness owns.
- **Kill criterion before calling A2A "equipped":** one MCP `ping_peer` to an idle target and one to a busy/steerable target both persist `meta.sentFrom=peer` + `peer.sourceSessionId` on the recipient row, and the model-facing prompt starts with `From: /sessions/<sender>`.

## Shipped / remaining

- [x] Restore peer-messages + Codex annotate (`163dfbc55`)
- [x] Remat tip `c5a182a12`; remat hold cleared; hub+runner restart
- [ ] Optional: hub/CLI refuse or hard-prefix if peer-delivery ingress lacks source (close the silent webapp hole if absorb regresses again)
- [ ] Optional: dogfood proof ping idle+busy after restart; attach hub row meta screenshot/JSON
- [ ] Upstream A2A PR: add absorb regression test + provenance-vs-deliveryMode note before merge push

## Friction

Steelmanning the queue hypothesis: sender's receipt partition is clean and human-convincing. Kill test it failed: decode the cited `localId`s — if steer rows had `sentFrom: peer` and idle rows did not, queue would be the mechanism. They did not. Cheapest ongoing falsification: after every soup absorb of `pingPeer.ts`, assert MCP path still POSTs peer-messages when `authenticatedSourceSessionId` is set (already unit-tested; keep it red-flag in absorb checklist).
