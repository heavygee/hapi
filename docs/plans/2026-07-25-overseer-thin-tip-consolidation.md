# Overseer fork-PR consolidation (thin-tip wave) — plan only

> **Status:** plan for a later meta wave. **Not** started 2026-07-25 — ContributionState A+S peers are in flight first.  
> **Problem:** 9 open `heavygee/hapi` overseer PRs (#54–#57, #81, #86–#91), several CONFLICTING with 200–300 file GitHub diffs because stacked bases still carry garden / fat history. Soup already runs a thinner tip stack.

## Do not

- Squash everything into one upstream mega-PR (unreviewable; fights stealth paving).
- "Consolidate" by editing GitHub PR titles without rebasing onto `upstream/main`.

## Do (when Meta picks this wave up)

Collapse into **~4 logical thin tips** on `upstream/main`, then close superseded fork PRs with "superseded by tip X":

| Tip | Contents | Notes |
|-----|----------|-------|
| 1 Substrate | events + inbox (#57) + stale-noise (#54) | One tip; rebase drops garden |
| 2 Replay | #55 alone on tip 1 | Keep CI gate / fixtures thin |
| 3 Readonly entity | #56 alone on tip 1 (or 2) | Step 3 inform-only |
| 4 Half-B | Collapse #81+#86+#87+#88+#91 → 1–2 PRs | "invisible+emit" / "fallbacks"; watch #87 spam KILL-CRITERION |

Coordinate with peers who own those tips (July 14 thin-tip receipts still relevant). Rematerialize soup **once** after tip swaps, not per close.

## Interaction with ContributionState

- Slice A (`POST /api/system-events`) stacks on current readonly-entity tip — fine during consolidation; rebase A onto new tip 3 when tip 3 replaces the fat stack.
- Do not block A/S on this wave.
