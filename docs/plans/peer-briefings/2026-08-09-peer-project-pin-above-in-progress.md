# Peer briefing: project pins above In progress floaters

**Spawned:** 2026-08-09  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/project-pin-above-in-progress`  
**Branch:** `fix/project-pin-above-in-progress` (from `upstream/main`)  
**Upstream issue:** https://github.com/tiann/hapi/issues/1431  
**Reporter parent:** [Peer: session-attached jobs](/sessions/6e70f97b-24c6-49bd-907f-98ce9bfc8b8f)

## Verdict (orchestrator)

**Not a random sort bug** — current composed order from #1115 + In progress section. **UX defect** for inbox: durable **project pin** loses to ephemeral unpinned In progress floaters when Display pin-in-progress is on (`all` / legacy true).

Recommended fix (locked unless operator overrides): keep project-pinned rows **inside** their project groups, but render **groups that contain project pins above the In progress section**.

Target order:

1. Global pinned band  
2. Directory groups with `hasPinnedSession` (project pins)  
3. In progress (unpinned hot / jobs per mode)  
4. Remaining directory groups  

Also tighten Settings/FUE copy if needed: project pin ≠ global top; after this fix, project-pinned *projects* still beat In progress.

## Do not

- Stack-switch / remat soup for this investigation (parent asked)  
- Collapse project pin into global pin  
- “Fix” by only documenting unless implementation is blocked  

## Your job

1. Implement reorder on this branch (+ tests for section order).  
2. Peer-stack proof PNG + soup dogfood when ready.  
3. Ping parent `6e70f97b` when dogfoodable.  
4. **No upstream PR until operator OK.**

## Status (peer)

- Tip: `fd4dec890` on `fix/project-pin-above-in-progress`
- Peer e2e: `e2e/peer/1431-project-pin-above-in-progress.spec.ts` (mirror)
- Parent pinged: `6e70f97b` — dogfoodable
- **Upstream PR:** https://github.com/tiann/hapi/pull/1432 (opened; proof PNG attached)
- Peer stack may still be up: `project-pin-above-in-progress` @ `:3103`
