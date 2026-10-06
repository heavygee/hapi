# Peer briefing: restore Pin in project = intra-group only (#1457)

**Spawned:** 2026-08-09  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/project-pin-intra-group-only`  
**Branch:** `fix/project-pin-intra-group-only` (from `upstream/main` @ `#1432`)  
**Upstream issue:** https://github.com/tiann/hapi/issues/1457  
**Related:** #1115 (correct model), #1431/#1432 (bad group lift)  
**Orchestrator:** [Peer #1431: project pin above in-progress](/sessions/de26fe4c-8aa2-48fa-9cf2-c5be1086dd21)

## Verdict (operator + orchestrator)

**#1432 was a product mistake.** “Pin in project” means first **inside that project folder** only. It must **not** promote whole folders above **In progress**.

Revert the #1432 section order. Restore:

1. Global pinned (if any)  
2. In progress  
3. Directory groups (project pins still first *inside* the group; #1115 among-group pin promotion may remain for findability, but groups must **not** render above In progress)

Also revert Settings copy that claims pin-projects beat In progress.

## Do not

- Collapse project pin into global pin  
- Remove #1115 dual-pin  
- Stack-switch without need; peer-stack proof + soup promote when dogfoodable  

## Your job

1. Implement revert on this branch (+ tests: In progress appears before pin-containing groups; project pin still first inside group).  
2. Peer-stack proof PNG; soup dogfood when ready.  
3. Ping orchestrator `de26fe4c` when dogfoodable.  
4. Upstream PR with `Fixes #1457`; issue already has `low-impact` for lane B after green.  
5. Do not merge `tiann/hapi` unless operator with TTY explicitly directs lane B.

Hard rules: product edits only in this worktree; never merge `tiann/hapi` without explicit lane B direction.
