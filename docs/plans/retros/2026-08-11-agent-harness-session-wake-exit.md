# Exit reflection: agent-harness-session-wake (PR #1487)

## Shipped as

- PR(s): tiann/hapi#1487 (Path A — ACP activity → hub `thinking`)
- Absorber: n/a
- Session: `90165da9` agent-harness session wake
- Issue: #1470 remains open (`Relates`; Path B still owed)

## Non-code residue

- Peer + soup dogfood: Cursor ACP `2026.08.04` prints notify sentinel after `turnEnded` but emits **no** post-idle `session/update` — Path A had nothing to bridge
- `afterShellExecution` also absent post-idle on ACP — shell-hook Path B is a dead end
- Ready YES was correctly scoped to Path A plumbing+tests; Meta rewrote PR body to `Relates #1470` so merge would not auto-close the issue
- Soup remat hit FAQ conflict (jobs vs harness); absorb kept both; live dogfood baseline thinking PASS / harness wake FAIL
- Stop-CC-Meta rule mid-babysit: ack remat owner / spawn parent only

## Promote?

- [x] `tooling issue` — title: Path B for #1470 (terminal-file watch or synthetic `session/prompt` when Cursor ACP does not resume on notify); why: Path A merged but acceptance criterion unmet until agent actually wakes or HAPI forces a turn
- [ ] `none`
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`

## Open questions / landmines

- Do not claim harness-wake PASS from Path A unit tests alone — kill-test requires live ACP post-idle traffic
- FAQ copy on Path A is aspirational until Cursor resumes ACP turns or Path B lands

## Skip

- n/a (lessons worth keeping)
