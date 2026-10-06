# Exit reflection: a2a-p05-peer-provenance (#1473 closed, no merge)

## Shipped as

- PR(s): tiann/hapi#1473 — **CLOSED without merge** (intentional product regroup)
- Absorber: n/a (not empty-vs-main; `main...pull/1473/head` still ~91 ahead). Thin successor is open **#1618** nametag-only (different scope, owned by nametag peer) — not a commit absorber
- Session: Peer #1203 /sessions/6212dae5-8a60-4284-b7a5-c09aa3571ce4

## Non-code residue

- Operator rejected fortress provenance (MCP inspect_peer / context bloat) → nametag-only thesis
- Meta sticky ⚠️ "closed WITHOUT merge" until chip unlinked (`PUT …/external-refs` → `[]`)
- Soup layers `feat/a2a-p05-peer-provenance` + `fix/peer-cap-inject-early-connect` DROPPED in driver-manifest (2026-08-17)
- Related babysits elsewhere: #1618 nametag; #1620 symlink coalesce (not this session)

## Promote?

- [x] `High-signal index` — already covered by existing empty-vs-main / chip-retarget rows; no new row needed for "intentional close ≠ absorber"
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`
- [ ] `none`

## Open questions / landmines

- Do not reopen #1473 for endless rebase; nametag #1618 is the product bet
- `doctor/provenance` soup tip may still reference cherry-picks from the fortress branch — leave until its own babysit decides

## Skip

- n/a (non-trivial product pivot)
