# Exit reflection: user-terminal-strip-agent-context (PR #2014)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): tiann/hapi#2014 (squash `b3a9c0cdd`); issue #2013
- Absorber: n/a
- Session: same babysit seat as #2004 after Gate A (chip #2014)

## Non-code residue

- Root cause: `TerminalManager.buildFilteredEnv` forwarded runner `HAPI_AGENT_CONTEXT` into human web Terminal PTYs; Lane B auth / stack-switch guards refused a real person.
- Fix: strip agent markers + set `HAPI_USER_TERMINAL=1`; keep `HAPI_SESSION_ID`; secrets still stripped.
- Chicken/egg: grant for this merge was still via SSH / non-agent TTY; soup remat needed before Terminal dogfood of the fix itself.
- Gate consume-on-dry-run still open: [heavygee/hapi#253](https://github.com/heavygee/hapi/issues/253) (not this PR).

## Promote?

- [x] `none` — contract is in `cli/README.md` + code; no AGENTS essay.
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`

## Open questions / landmines

- After Meta wave remat: dogfood session Terminal — `printenv HAPI_AGENT_CONTEXT` empty, `HAPI_USER_TERMINAL=1`, then `hapi-laneb-authorise` reaches MERGE prompt.

## Skip

n/a
