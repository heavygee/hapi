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

## The question

**Does the fork's row redesign get upstreamed so the two converge, or is it a deliberate fork-only divergence with an accepted conflict budget?**

Three honest options:

1. **Upstream the redesign.** The fork's row UI (attached-job progress, blocked chips, issue refs) is arguably better than upstream's badge corner and is exactly the kind of thing a stranger would want. If it lands upstream, the divergence ends and Ian's PR becomes a merge rather than a redesign. Cost: PR work, review latency, and upstream may decline.
2. **Accept the divergence explicitly.** Keep the fork design, write down that `SessionRowSummary.tsx` is a permanent conflict site, and budget for it — meaning every upstream bump gets a deliberate resolution with a symbol-preservation check, not a hurried one at the end of a compose.
3. **Revert toward upstream.** Drop the fork-only row features to stop the bleeding. Probably wrong — they are in daily use — but it should be named rather than silently excluded.

**Recommendation: (1), with (2) as the interim.** Upstreaming converges the file and removes the recurring tax; until it lands, treat the file as a known conflict site and resolve it with the symbol-diff check rather than tests alone.

## What to do regardless of the answer

Any resolution on a file in this class must be verified by **diffing the declared/exported symbol set against both parents** — anything present in either parent and absent after the merge is a silent drop. That is the check `--verify` cannot perform, and the one that would have caught 11-05.

Candidates for the same treatment, unaudited: any file where the fork has replaced rather than extended upstream behaviour. Worth a sweep before the next release bump.
