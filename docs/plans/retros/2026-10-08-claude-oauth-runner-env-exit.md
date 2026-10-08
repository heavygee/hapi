# Exit reflection: claude-oauth-runner-env (PR #192)

## Shipped as

- PR(s): heavygee/hapi#192 → `fa994aa04` (Fixes #191)
- Absorber: n/a
- Session: Doug cannot start new Claude session (`28c70f5d…`)

## Non-code residue

- Acute antevorta outage was hand-patched 2026-10-01; PR is the durable installer path so the next fleet upgrade cannot silently drop ambient Claude OAuth.
- Long Codex babysit inflated the tip into a kitchen-sink (Meta/remat commits rode along). Land path was rebase-onto-main as one clean tip, not conflict-resolve 65 commits.
- `gh pr merge -R heavygee/hapi` does **not** satisfy the merge-gate wrapper (parses `--repo` only); cwd/`gh repo view` defaulted to `tiann/hapi` and nearly gated the wrong #192.
- Duplicate Actions check-runs on the same SHA (one cancelled) leave `conclusion=cancelled` and block `hapi-pr-merge-gate` until a fresh tip.
- Foreign mirror dirt preserved in stash `wip 28c70f5d GateA-#192 preserve foreign mirror dirt` — do not drop; not this session's work.

## Promote?

- [x] `lifecycle / tooling doc` — `docs/tooling/pr-review-loop.md` or merge-gate README: note that merge wrapper requires `--repo`, not `-R`, when default `gh` repo is upstream.
- [ ] `High-signal index` — optional one-liner: fork OAuth EnvironmentFile is first-class in fleet+pet installers (`lib/hapi-claude-oauth-dropin.sh`).
- [ ] `none`

## Open questions / landmines

- Antevorata still needs a real fleet-binary reinstall/upgrade to pick up installer-produced drop-in if anyone ever removes the hand install.
- `hapi-meta-daily.test.sh` still skipped in soup-redeploy CI (known hang) — Meta delivery/fingerprint fixes are covered locally but not by that job.
