# Exit reflection: cursor-unexpected-stop-notify (#211, #241, tiann/hapi#1991)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): heavygee/hapi#211 (Blocked-footer wire), heavygee/hapi#241 (auto-Continue restore)
- Upstream: tiann/hapi#1991 (open, blocked on their CI outage — see below)
- Follow-ups filed, not shipped here: heavygee/hapi#212 (stderr-hang gap, claimed as my own follow-up)
- Session: this one (heavygee/hapi#209 babysit)

## Non-code residue

- **Silent soup-rebase drops are not a one-off.** The exact same "thin onto tip" mechanism dropped two independent, already-merged-into-soup fixes (#211's Blocked wire, then separately #1724's auto-Continue) months apart, from the same file, with zero alarm until a live operator incident. One bug landing twice is a process gap, not a code gap — #242 tracks the invariant; worth a `driver-soup.md` note on "launcher-touching layers go last" as a standing rule, not tribal memory.
- **`hapi-pr-status`'s fork-side bot-verdict check has a false-negative.** It only regexes the Codex rollup comment body for "Didn't find any" text; it doesn't check the PR-level 👍 reaction, which is Codex's actual documented "no findings" signal for this template shape. Cost ~15 min of unnecessary investigation on #211 before I found the reaction via the API and self-applied `cold-review-clean` with a documented reason. Small, mechanical fix (check `GET /issues/{n}/reactions` for a `chatgpt-codex-connector[bot]` `+1`) — worth a tooling issue.
- **PR-chip linking is easy to forget mid-flow.** I opened and actively babysat two PRs for a full session before the operator had to point out there was no chip on either. `hapi link-pr` needs to become a reflexive same-turn step right after `gh pr create`/`hapi-pr-create(-fork)`, not something remembered later. No tooling fix needed — this is a habit note for future sessions in this seat.
- **Live GitHub infra can fail silently in two unrelated ways at once**, and both looked alike from the outside (red/absent check) but needed different handling: tiann/hapi's Codex-review model backend returned a real, recurring `503` (retry pointless, just wait/document) vs. heavygee/hapi's GitHub Actions being fully disabled org/billing-side (`workflow_dispatch` → `422 Actions has been disabled`, confirmed by the tooling bot) — only distinguishable by actually probing (check-suites API, cross-referencing other unrelated PRs/branches), not by the check UI alone. Worth remembering: an absent/red check is not self-explanatory — verify before assuming it's your diff.
- **Verifying a live fix without a safe fault-injection point is a real limit.** The #1724 auto-Continue path needs a *soft* retryable transport error while the ACP process survives; a full `kill -9` only exercises the (correctly-handled) full-process-death branch instead. Confirmed the harder path via a precise, PID-verified controlled kill rather than guessing — but true end-to-end coverage of the soft-retry branch stays unit-test-only unless someone builds a fault-injection hook into the ACP transport layer. Not worth doing for this incident; flagging in case it recurs.
- **Soup `main` as PR base can silently include a tooling-bot `chore(soup):` commit already referencing your not-yet-opened fix** (`075fb85ed` showed up on `origin/main` naming `driver/1724-auto-continue-delta` before I'd even started porting it) — the tooling bot and I were working the same incident in parallel without explicit hand-off-and-wait; worked out fine here (no actual conflict, just surprising to discover mid-investigation), but worth noticing that "you own this gap" + urgent operator escalation can produce two agents racing the same fix.

## Promote?

- [x] `tooling issue` — "hapi-pr-status: fork-side Codex clean verdict should also check PR-level 👍 reaction, not just rollup comment text" (false FINDINGS PRESENT when Codex's only signal is the reaction). File against `heavygee/hapi` tooling, reference this retro + PR #211's comment thread for the worked example.
- [ ] `High-signal index` — n/a, covered by #242/#243 already tracking the two bigger structural findings.

## Open questions / landmines

- `driver/1724-auto-continue-delta` is still a live manifest layer (not mine to drop — tooling bot owns it) pending eventual absorption once `main`'s tip-forward naturally supersedes the separate thin layer. Next person touching `cursorAcpRemoteLauncher.ts` soup layering should check it's still needed before assuming it's stale.
- tiann/hapi#1991 is still open, blocked purely on their repo-wide Codex-review outage (not a real finding) — needs periodic re-check/retry, not re-engineering, until their infra recovers.
- heavygee/hapi#212 (stderr-hang gap in `wireStderrErrorListener`) is claimed but not started — real design work needed (bounded timeout vs. stderr-driven abort), separate from everything landed here.
