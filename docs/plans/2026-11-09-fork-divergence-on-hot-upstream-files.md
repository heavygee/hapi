# Decision needed: fork divergence on files upstream is actively developing

**Status:** open, operator's call. Nothing blocked today — `driver/2296-presence-badges` is parked (`535ab4975`), branch left pushed at `5baf98fd5`.

## What surfaced it

A feature peer tried to compose upstream `tiann/hapi#2296` (IanMStevenson — presence badges for every session state) as a soup layer. It could not be re-thinned onto the live tip, and not for a mechanical reason. Measured in `web/src/components/SessionRowSummary.tsx`:

| Marker | soup tip `ff7e86490` | upstream 0.34.4 `2161a9ff9` |
|---|---|---|
| `session-presence` (the element the PR patches) | **0** | 1 |
| `attachedJob` | **16** | 0 |
| `SessionSpinner` | **3** | 0 |
| `opacity-50` (row dimming) | **1** | 0 |

The fork replaced upstream's icon-corner presence badge with its own design — row-level opacity dimming, an inline spinner, blocked-state chips, issue-ref chips, attached-job progress. A test cherry-pick of Ian's commit conflicted in all three files and was not resolvable by picking a side: his patch assumes a JSX element that no longer exists here.

## The actual problem, which is bigger than that PR

**The fork has rewritten a file upstream is actively developing.** Every upstream bump will conflict in `SessionRowSummary.tsx`, forever, across a large surface — and nobody owns the decision to pay that.

This is not hypothetical, and it is not one file. The same class cost us twice in 48 hours:

- **`pingPeer.ts`, 2026-11-05.** `1b4438be5` ("clear remat verify CLI failures after tip-forward") rewrote the file −426/+184 and silently deleted resolve-by-`agentSessionId` (fork #137, Fixes #1203). Invisible for three days; surfaced as three agents unable to cite each other by durable id. See `2026-11-08-ancestry-vs-presence-verification-gap.md`.
- **`pingPeer.ts` again, 2026-11-09.** One of three conflicts blocking the 0.34.4 sync, where upstream's `waitForReply` (#2167) and the fork's inspect paging are independent additions at the same spot. See `2026-11-09-upstream-0344-sync-conflicts.md`.

**The tax is not the conflict, it is the resolution.** Each one is a chance to silently drop a feature, and our measured rate is not good: of 14 conflicts resolved on 11-08, four produced regressions — one of which let a sticky preference nobody set override the operator's hub config. Green suites do not catch this class; the 11-05 loss passed verify because no test covered the deleted feature.

## Design detail: what soup's row UI does today (facts only, for the option-1 argument)

Anyone arguing option 1 (upstream the redesign) has to show it's a strict gain, not a trade. Here's what's actually in `SessionRowSummary.tsx` on the soup tip, read directly off the file rather than inferred from the marker counts above.

**What soup has that upstream's badge corner doesn't:**

- **Blocked-state chip** (`data-testid="session-blocked-chip"`, `getSessionBlockedState`/`getSessionBlockedLabelKey`/`sessionBlockedIsError`) — a labeled, colored chip (error vs warning vs stale border) with its own tooltip/`aria-label`, independent of the presence/attention channel. Upstream has no equivalent concept.
- **Issue-ref chip** (`IssueRefChip`, `getLinkedGithubIssue`) — shows a linked GitHub issue inline on the row. Fork-only, no upstream equivalent.
- **Attached-job progress** (`attachedJobFraction`, `formatAttachedJobProgress`, `isAttachedJobStale`, a `setInterval`-driven minute tick) — a session can show fractional progress / staleness for work that outlives the agent. Upstream's model has no concept of a job surviving session inactivity. **Row opacity is no longer tied to the job** — see 2026-11-09 residency-fade note below (was: inactive + running job stayed full-opacity; that is the change under discussion).
- **Foreground vs background spinner distinction** (`isAgentForegroundThinking(s)` → plain `SessionSpinner`; background task count → `SessionSpinner background`, a blue variant) — two visually distinct spinners for "the agent itself is thinking" vs "a background task is running while the agent is idle." Upstream's badge only had a binary pulse (green working / blue background), not a spinner-shape distinction.

**What soup does NOT have that upstream's (and Ian's open PR's) badge-per-state design does:**

- **No affirmative "waiting" mark.** A session that is `active: true`, not thinking, no background task, no pending/urgent attention, not unread renders with *nothing* in the marker slot — full opacity, fg-colored title, no icon, no dot, no spinner. It is visually identical to "nothing is happening here," distinguished from a genuinely idle/disconnected row only by the row-level dimming (below).
- **"Stopped" is shown by absence (dimming), not by an affirmative mark.** `!s.active` → `opacity-50` + `text-[var(--app-hint)]` title (after residency-fade; previously also exempted running `attachedJob`). There's no icon, glyph, or dot that says "this session is stopped" — just reduced emphasis on the whole row. A user has to notice a dimmer row, not read a distinct symbol.
- **So stopped vs waiting *is* distinguishable today** — by the opacity/color toggle alone — but neither state gets a dedicated visual identity the way working (spinner) and background (blue spinner) and blocked (chip) do. Ian's PR's whole premise (own code comment: "every state has its own mark, so no state is shown by the absence of one") is specifically the thing soup's current design does for exactly these two states.

### 2026-11-09 operator decision — residency fade vs attached jobs (layer `driver/session-row-residency-fade`)

**Decision (operator, routed via Meta):** a session that is **not resident** (`!s.active`) but has a **running attached job** should render **faded**, not full-opacity. Job visibility stays on the job's own affordance (progress / chip / spinner), not by un-dimming the row.

**Why (estate semantics):** on this machine the row fade means "is this session taking RAM" — its whole purpose when scanning ~30 sessions for what is actually resident. Attached jobs exist specifically so work can outlive the agent; exempting them from dimming (`!s.active && !attachedJob` / `s.active || attachedJob` on soup before this layer) made the common case look resident when it was not, and eroded the scan signal as jobs got more common.

**What this deepens:** it extends dimming to the one prior "stopped-looking but live" exception. That moves the fork **further** from Ian's affirmative-mark premise (absence/dimming for stopped) and further from any upstream that treats opacity as unrelated to presence. It does **not** remove the job signal — the progress chip remains. It does **not** belong on `tiann/hapi#1424` (no `opacity-50` in that PR's diff; tip uses a different row structure post-upstream rewrite).

**Option-1 / option-2 impact:** if we upstream the fork row design, this decision is part of the pitch: "fade = residency; jobs speak through their chip." If we converge toward upstream/Ian badges, this layer is more debt to unwind (or to re-express as an affirmative "held by job, not by runner" mark). Either way it must not land as an undocumented silent deepen of the divergence — hence this note. Layer: `driver/session-row-residency-fade` @ `a740628eb`; owner `/sessions/6e70f97b`.

**Net for the option-1 argument:** soup's redesign is additive in three real ways (blocked chip, issue chip, job progress) that upstream would likely want on their own merits, independent of presence semantics. But it is a net *regression* on affirmative-state legibility for exactly the two states (stopped, waiting) that prompted Ian's PR in the first place — and residency-fade makes the "stopped by absence" choice apply even when a job is live. An upstreaming pitch that leads with "our row is strictly better" would be factually wrong on that point; a pitch that says "ours adds X/Y/Z, fade means RAM not work, and separately we should fold in an explicit stopped/waiting/(job-held) mark" is the accurate framing.

## The question

**Does the fork's row redesign get upstreamed so the two converge, or is it a deliberate fork-only divergence with an accepted conflict budget?**

Three honest options:

1. **Upstream the redesign — but split the pitch.** Corrected by the design section above, which contradicts the first draft of this line. The fork's additions (blocked chip, issue chip, attached-job progress, foreground-vs-background spinner) are a genuine gain upstream would likely want on their own merits. The fork's *presence* handling is **not** — showing stopped and waiting by absence/dimming rather than an affirmative mark is a regression against exactly the premise of Ian's PR. So: pitch the additions, and **separately fold in an explicit stopped/waiting mark** rather than claiming the fork's row is strictly better. A pitch that leads with "ours is better" is factually wrong on the one point the upstream author cares most about, and would deserve to be rejected.
2. **Accept the divergence explicitly.** Keep the fork design, write down that `SessionRowSummary.tsx` is a permanent conflict site, and budget for it — meaning every upstream bump gets a deliberate resolution with a symbol-preservation check, not a hurried one at the end of a compose.
3. **Revert toward upstream.** Drop the fork-only row features to stop the bleeding. Probably wrong — they are in daily use — but it should be named rather than silently excluded.

**Recommendation: (1) in the split form above, with (2) as the interim.** Upstreaming converges the file and removes the recurring tax; until it lands, treat the file as a known conflict site and resolve it with the symbol-diff check rather than tests alone.

**Note on how this recommendation was reached, because it matters for the next one.** The first draft of option 1 asserted the fork's row was "arguably better" — written by the kitchen from marker counts, without reading the rendering logic. The feature peer then read the actual file and showed that claim is wrong for stopped and waiting. The marker counts proved *divergence*; they said nothing about *quality*, and the recommendation leaned on them for a conclusion they could not support. Same shape as the other failures in this estate's recent record: a measurement answering a question adjacent to the one being decided.

## What to do regardless of the answer

Any resolution on a file in this class must be verified by **diffing the declared/exported symbol set against both parents** — anything present in either parent and absent after the merge is a silent drop. That is the check `--verify` cannot perform, and the one that would have caught 11-05.

Candidates for the same treatment, unaudited: any file where the fork has replaced rather than extended upstream behaviour. Worth a sweep before the next release bump.
