# Exit reflection: waiting-external-block (PR #2616)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): [#2616](https://github.com/tiann/hapi/pull/2616) — `88c2c1372` squash on `upstream/main` (2026-11-28)
- Absorber (if superseded): n/a
- Session: [archive-peer-2020 / waiting write-path](/sessions/c99aab2b-2481-45f5-9762-968fdfe549bb) (also still owns parked #2021)
- Follow-up filed: [#2655](https://github.com/tiann/hapi/issues/2655) (operator-cancel stale `waiting`)

## Non-code residue

- **The split was the unlock.** #2021 sat ~2 days at ~105 files; carving the generic `metadata.waiting` half into #2616 got Approach accepted first pass and merged the same morning. Transferable: when a feature grows into infrastructure repair, ship the small generic half first.
- **Clean verdict is perishable.** Tip `28915d9eb` was All-stages + MERGEABLE; spending it on a Minor (`b6ed9b48e`) voided gate 4 and re-exposed Approach/golden-race risk. Rule: once you hold a clean tip-matched verdict, **Minors become follow-ups** — Majors are always work. Do not "improve" a Ready tip.
- **Deferral → record, not dismissal.** Operator-cancel leaving stale `waiting` is a real gap; "sticky across turns" only answers natural turn-end. Corrected scope in-thread and filed #2655 rather than re-pasting the wrong rationale.
- **Main was green; the red was merge-order.** #2562 changed AGY citation shape; our branch met the new interface. Do not wait for "main to heal" when main's checks are green — adapt the diff.
- **Parity goldens: regenerate after colliding merges, never hand-stitch.** #2592 overlapped 15 Claude goldens; re-record after its land was the correct second-mover path (our fixtures are the superset with `session_waiting`).
- **Evidence-first pushback is expected.** Archive-exception defence and worker-liveness framing corrected Meta with receipts — successors should treat that as the job, not presumption.
- Gate 3 (unresolved threads) can fail with zero tip change — check thread count before declaring hands-off.

## Promote?

- [x] `none` — lessons are session/ops; no High-signal row or lifecycle patch required this wave
- [ ] `High-signal index` —
- [ ] `lifecycle / tooling doc` —
- [ ] `tooling issue` — (product follow-up already filed: #2655)

## Open questions / landmines

- #2021 Approach Needs-changes (ownership/generation keying) still with operator — 2–4 day estimate; do not start generation ledger from this seat until scoped.
- #2655: clear `waiting` on confirmed operator cancel without wiping a newer wait — needs cross-flavor interrupt hook.

## Skip

- n/a
