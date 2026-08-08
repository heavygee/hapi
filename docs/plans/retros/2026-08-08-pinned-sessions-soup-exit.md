# Exit reflection: pinned-sessions soup (#1115)

> Gate A' dogfood #1 — peer `eb94db45` before Meta archive.

## Shipped as

- PR(s): [tiann/hapi#1115](https://github.com/tiann/hapi/pull/1115) (squash `3da9f7780`, heavygee merge 2026-08-08); closes [#532](https://github.com/tiann/hapi/issues/532)
- Absorber: n/a (merged as-authored dual-mode tip; soup single-band layer dropped)
- Session: `eb94db45` — Peer: soup pinned-sessions dogfood (done)

## Non-code residue

- Schema collision is the kill-criterion for soup-promoting open PRs: #1115 claimed pin@v20 while soup/#1390 already owned v20/v21 → pin landed soup@v22, then upstream tip correctly remapped to v22 dual columns (`pinned` + `global_pinned`).
- Blind `pr: 1115` / raw author tip on manifest would have clobbered usage migrations; needed a **union tip** + later remat heal when upstream dual-mode landed.
- Live DBs already at SCHEMA 23 with only `pinned` skip the v21→v22 step — need **idempotent column ensure** (`ensureSessionPinColumns` in `finishSchemaInit`), not version bumps alone.
- Unsolicited estate-jargon comments on others' PRs are wrong venue (incident `#issuecomment-5204453417`); Public GitHub voice now in `docs/operator/AGENTS.md` — operator-first, do not police authors.
- Author accepted feedback, declined our rebase offer, shipped project+global pin + In-progress interaction fix; stale Codex threads were ledger dirt — resolve after tip verify, don't treat Meta FAIL as code FAIL.
- Remat tip-forward after merge: prefer **upstream dual-pin surfaces**, keep soup SCHEMA 23 + jobs; first thin-upstream union broke vite — Meta re-resolved (`0c6b0f874`).
- Collaborator merge of a green schema feature is justifiable with hand-on-heart after CLEAN; it is **not** auto-B / `low-impact` (32 files, +887, hub migration).

## Promote?

- [x] `lifecycle / tooling doc` — `docs/tooling/driver-soup.md` (or lifecycle § After upstream merge): one short note that absorbing a merged community schema PR may require (1) drop soup layer, (2) tip-forward prefer upstream product surfaces, (3) **column ensure** when live `user_version` already past the migration that added columns.
- [ ] `High-signal index` — optional second: only if Meta wants a one-liner pointing at Public GitHub voice (already shipped 2026-08-06); otherwise leave.

**Meta promote bar (05d9f0f2, 2026-08-08):** applied → `driver-soup.md` § Absorbing a merged community schema PR. High-signal **none** (Public GitHub voice already indexed).

## Open questions / landmines

- Soup session-jobs (#1404) still owns v23 while upstream pin owns v22 — next schema PR must not invent a second v22 for product on soup without remumber.
- Remote tracking noise: `heads/techotaku39/feat/web-pinned-sessions` may linger in audit as NO-TRACKING; ignore or prune fetch refs, not a product branch.

## Skip

- n/a (not trivial)
